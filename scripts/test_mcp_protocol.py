#!/usr/bin/env python3
"""
Test that MCP servers can initialize the MCP protocol.
Uses mock credentials - the server will start but API calls will fail.
This verifies the MCP protocol handling works correctly.
"""

import json
import subprocess
import sys
import os
from pathlib import Path

def test_mcp_initialization(name: str, command: list[str], env: dict) -> bool:
    """Test MCP protocol initialization"""
    print(f"\nTesting {name}...")
    
    full_env = {**os.environ, **env}
    
    try:
        process = subprocess.Popen(
            command,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=full_env,
            text=True,
        )
        
        # Send initialize request
        init_request = json.dumps({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {"name": "test", "version": "1.0.0"}
            }
        }) + "\n"
        
        process.stdin.write(init_request)
        process.stdin.flush()
        
        # Read response
        response_line = process.stdout.readline()
        if not response_line:
            stderr = process.stderr.read()
            print(f"  ✗ No response. stderr: {stderr[:500]}")
            return False
        
        response = json.loads(response_line)
        
        if "error" in response:
            print(f"  ✗ Protocol error: {response['error']}")
            return False
        
        result = response.get("result", {})
        server_info = result.get("serverInfo", {})
        print(f"  ✓ Initialize OK - {server_info.get('name', '?')} v{server_info.get('version', '?')}")
        
        # Send initialized notification
        process.stdin.write(json.dumps({
            "jsonrpc": "2.0",
            "method": "notifications/initialized",
            "params": {}
        }) + "\n")
        process.stdin.flush()
        
        # Send tools/list
        process.stdin.write(json.dumps({
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/list",
            "params": {}
        }) + "\n")
        process.stdin.flush()
        
        tools_line = process.stdout.readline()
        if tools_line:
            tools_response = json.loads(tools_line)
            if "result" in tools_response:
                tools = tools_response["result"].get("tools", [])
                print(f"  ✓ Tools listed: {len(tools)} tools available")
                
                # Print first few tool names
                for t in tools[:5]:
                    print(f"      - {t['name']}")
                if len(tools) > 5:
                    print(f"      ... and {len(tools) - 5} more")
                
                return True
        
        print("  ✗ No tools response")
        return False
        
    except json.JSONDecodeError as e:
        print(f"  ✗ JSON error: {e}")
        return False
    except Exception as e:
        print(f"  ✗ Exception: {e}")
        return False
    finally:
        try:
            process.terminate()
            process.wait(timeout=2)
        except:
            pass


def main():
    success = True
    
    # Test PostgreSQL TypeScript
    pg_ts_path = Path(__file__).parent.parent / "typescript" / "dist" / "index.js"
    if pg_ts_path.exists():
        pg_env = {
            "POSTGRES_HOST": "localhost",
            "POSTGRES_PORT": "5433",
            "POSTGRES_USER": "testuser",
            "POSTGRES_PASSWORD": "testpass",
            "POSTGRES_DB": "testdb",
            "POSTGRES_SSLMODE": "disable",
        }
        if not test_mcp_initialization("PostgreSQL TypeScript", ["node", str(pg_ts_path)], pg_env):
            success = False
    else:
        print(f"PostgreSQL TypeScript not built: {pg_ts_path}")
        success = False
    
    # Test Bitbucket TypeScript
    bb_ts_path = Path(__file__).parent.parent.parent / "bitbucket-mcp" / "typescript" / "dist" / "index.js"
    if bb_ts_path.exists():
        bb_env = {
            "BITBUCKET_WORKSPACE": "test-workspace",
            "BITBUCKET_EMAIL": "test@example.com",
            "BITBUCKET_API_TOKEN": "test-token",
        }
        if not test_mcp_initialization("Bitbucket TypeScript", ["node", str(bb_ts_path)], bb_env):
            success = False
    else:
        print(f"Bitbucket TypeScript not built: {bb_ts_path}")
    
    print("\n" + "=" * 50)
    if success:
        print("✓ All MCP protocol tests passed!")
        print("\nThe TypeScript servers initialize correctly.")
        print("For full integration testing, you need:")
        print("  - PostgreSQL: docker-compose up -d")
        print("  - Bitbucket: Set BITBUCKET_* environment variables")
    else:
        print("✗ Some tests failed")
        sys.exit(1)


if __name__ == "__main__":
    main()

