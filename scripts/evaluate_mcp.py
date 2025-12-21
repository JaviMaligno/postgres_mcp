#!/usr/bin/env python3
"""
MCP Server Evaluation Script for PostgreSQL MCP

This script tests both Python and TypeScript implementations of the PostgreSQL MCP server
to verify they expose the same tools and produce equivalent results.

Prerequisites:
    - Docker must be running
    - Run `docker-compose up -d` from the repo root to start PostgreSQL

Usage:
    # Start the test database
    docker-compose up -d

    # Run the evaluation (waits for DB to be ready)
    python scripts/evaluate_mcp.py
    
    # Or run only TypeScript version
    python scripts/evaluate_mcp.py --ts-only
    
    # Stop the database after testing
    docker-compose down
"""

import json
import subprocess
import sys
import os
import argparse
import time
from typing import Any, Optional
from dataclasses import dataclass, field
from pathlib import Path

# MCP JSON-RPC message IDs
_message_id = 0

def next_id() -> int:
    global _message_id
    _message_id += 1
    return _message_id


def wait_for_postgres(host: str, port: int, user: str, password: str, db: str, timeout: int = 30) -> bool:
    """Wait for PostgreSQL to be ready"""
    import socket
    
    start = time.time()
    while time.time() - start < timeout:
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(1)
            result = sock.connect_ex((host, port))
            sock.close()
            if result == 0:
                # Port is open, wait a bit more for full initialization
                time.sleep(2)
                return True
        except socket.error:
            pass
        time.sleep(1)
    return False


@dataclass
class MCPServer:
    """Manages an MCP server subprocess"""
    name: str
    command: list[str]
    env: dict[str, str]
    cwd: Optional[str] = None
    process: Optional[subprocess.Popen] = None
    
    def start(self) -> None:
        """Start the MCP server process"""
        full_env = {**os.environ, **self.env}
        self.process = subprocess.Popen(
            self.command,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=full_env,
            cwd=self.cwd,
            text=True,
            bufsize=1,
        )
        # Send initialize request
        self._send_request("initialize", {
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": {"name": "evaluate_mcp", "version": "1.0.0"}
        })
        # Send initialized notification
        self._send_notification("notifications/initialized", {})
    
    def stop(self) -> None:
        """Stop the MCP server process"""
        if self.process:
            self.process.terminate()
            try:
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.process.kill()
    
    def _send_request(self, method: str, params: dict) -> dict:
        """Send a JSON-RPC request and wait for response"""
        if not self.process or not self.process.stdin or not self.process.stdout:
            raise RuntimeError(f"Server {self.name} not started")
        
        msg_id = next_id()
        request = {
            "jsonrpc": "2.0",
            "id": msg_id,
            "method": method,
            "params": params
        }
        
        # Send request
        request_line = json.dumps(request) + "\n"
        self.process.stdin.write(request_line)
        self.process.stdin.flush()
        
        # Read response (may need to skip notifications)
        while True:
            response_line = self.process.stdout.readline()
            if not response_line:
                stderr = self.process.stderr.read() if self.process.stderr else ""
                raise RuntimeError(f"Server {self.name} closed unexpectedly: {stderr}")
            
            try:
                response = json.loads(response_line)
                # Skip notifications (no id field)
                if "id" in response:
                    return response
            except json.JSONDecodeError as e:
                print(f"[{self.name}] Invalid JSON: {response_line[:100]}...", file=sys.stderr)
                continue
    
    def _send_notification(self, method: str, params: dict) -> None:
        """Send a JSON-RPC notification (no response expected)"""
        if not self.process or not self.process.stdin:
            raise RuntimeError(f"Server {self.name} not started")
        
        notification = {
            "jsonrpc": "2.0",
            "method": method,
            "params": params
        }
        notification_line = json.dumps(notification) + "\n"
        self.process.stdin.write(notification_line)
        self.process.stdin.flush()
    
    def list_tools(self) -> list[dict]:
        """Get list of available tools"""
        response = self._send_request("tools/list", {})
        if "error" in response:
            raise RuntimeError(f"Error listing tools: {response['error']}")
        return response.get("result", {}).get("tools", [])
    
    def call_tool(self, name: str, arguments: dict) -> dict:
        """Call a tool and return the result"""
        response = self._send_request("tools/call", {
            "name": name,
            "arguments": arguments
        })
        if "error" in response:
            return {"error": response["error"]}
        
        result = response.get("result", {})
        # Extract text content from MCP response format
        contents = result.get("content", [])
        if contents and len(contents) > 0:
            text = contents[0].get("text", "{}")
            try:
                return json.loads(text)
            except json.JSONDecodeError:
                return {"raw": text}
        return result


@dataclass
class TestResult:
    """Result of a single tool test"""
    tool_name: str
    success: bool
    python_result: Optional[dict] = None
    typescript_result: Optional[dict] = None
    error: Optional[str] = None
    differences: list[str] = field(default_factory=list)


def compare_results(py_result: dict, ts_result: dict, ignore_keys: set[str] = None) -> list[str]:
    """Compare two result dictionaries and return list of differences"""
    if ignore_keys is None:
        ignore_keys = {
            "last_vacuum", "last_autovacuum", "last_analyze", "last_autoanalyze",
            "created", "updated", "timestamp", "current_connections"
        }
    
    differences = []
    
    # Check for errors
    if "error" in py_result and "error" not in ts_result:
        differences.append(f"Python returned error, TypeScript did not: {py_result['error']}")
    elif "error" not in py_result and "error" in ts_result:
        differences.append(f"TypeScript returned error, Python did not: {ts_result['error']}")
    elif "error" in py_result and "error" in ts_result:
        return []  # Both errored, consider this a match
    
    # Compare top-level keys
    py_keys = set(py_result.keys()) - ignore_keys
    ts_keys = set(ts_result.keys()) - ignore_keys
    
    if py_keys != ts_keys:
        missing_in_ts = py_keys - ts_keys
        missing_in_py = ts_keys - py_keys
        if missing_in_ts:
            differences.append(f"Keys missing in TypeScript: {missing_in_ts}")
        if missing_in_py:
            differences.append(f"Keys missing in Python: {missing_in_py}")
    
    # Compare common keys
    for key in py_keys & ts_keys:
        if key in ignore_keys:
            continue
        py_val = py_result[key]
        ts_val = ts_result[key]
        
        # For arrays, compare length and structure
        if isinstance(py_val, list) and isinstance(ts_val, list):
            if len(py_val) != len(ts_val):
                differences.append(f"Array '{key}' length differs: Python={len(py_val)}, TypeScript={len(ts_val)}")
        elif type(py_val) != type(ts_val):
            # Allow int/float comparison
            if not (isinstance(py_val, (int, float)) and isinstance(ts_val, (int, float))):
                differences.append(f"Type mismatch for '{key}': Python={type(py_val).__name__}, TypeScript={type(ts_val).__name__}")
    
    return differences


# Safe read-only tools to test (no execute operations)
SAFE_TOOLS = [
    ("list_schemas", {}),
    ("list_tables", {"schema": "public"}),
    ("describe_table", {"table_name": "customers", "schema": "public"}),
    ("describe_table", {"table_name": "orders", "schema": "public"}),
    ("list_indexes", {"table_name": "orders", "schema": "public"}),
    ("list_constraints", {"table_name": "orders", "schema": "public"}),
    ("list_views", {"schema": "public"}),
    ("describe_view", {"view_name": "customer_order_summary", "schema": "public"}),
    ("list_functions", {"schema": "public"}),
    ("table_stats", {"table_name": "customers", "schema": "public"}),
    ("get_database_info", {}),
    ("search_columns", {"search_term": "email"}),
    ("query", {"sql": "SELECT * FROM customers LIMIT 5"}),
    ("explain_query", {"sql": "SELECT * FROM orders WHERE status = 'pending'", "analyze": False}),
]


def run_evaluation(
    python_cmd: list[str],
    typescript_cmd: list[str],
    env: dict[str, str],
    python_cwd: str,
    ts_only: bool = False,
) -> list[TestResult]:
    """Run the evaluation comparing Python and TypeScript MCP servers"""
    
    results: list[TestResult] = []
    
    # Start servers
    ts_server = MCPServer("TypeScript", typescript_cmd, env)
    py_server = MCPServer("Python", python_cmd, env, cwd=python_cwd) if not ts_only else None
    
    try:
        print("Starting MCP servers...")
        ts_server.start()
        print(f"  ✓ TypeScript server started")
        
        if py_server:
            py_server.start()
            print(f"  ✓ Python server started")
        
        # List and compare tools
        print("\n--- Tool Listing ---")
        ts_tools = ts_server.list_tools()
        ts_tool_names = {t["name"] for t in ts_tools}
        print(f"TypeScript: {len(ts_tools)} tools")
        
        if py_server:
            py_tools = py_server.list_tools()
            py_tool_names = {t["name"] for t in py_tools}
            print(f"Python: {len(py_tools)} tools")
            
            missing_in_ts = py_tool_names - ts_tool_names
            missing_in_py = ts_tool_names - py_tool_names
            
            if missing_in_ts:
                print(f"  ⚠ Missing in TypeScript: {missing_in_ts}")
            if missing_in_py:
                print(f"  ⚠ Missing in Python: {missing_in_py}")
            if not missing_in_ts and not missing_in_py:
                print(f"  ✓ Tool sets match!")
        
        # Test safe tools
        print("\n--- Testing Read-Only Tools ---")
        
        for tool_name, args in SAFE_TOOLS:
            args_str = json.dumps(args) if args else "{}"
            print(f"\nTesting: {tool_name}({args_str[:50]}...)" if len(args_str) > 50 else f"\nTesting: {tool_name}({args_str})")
            result = TestResult(tool_name=tool_name, success=True)
            
            try:
                ts_result = ts_server.call_tool(tool_name, args)
                result.typescript_result = ts_result
                
                if "error" in ts_result:
                    print(f"  TypeScript: ⚠ {ts_result['error']}")
                else:
                    # Show a summary of results
                    if "rows" in ts_result:
                        print(f"  TypeScript: ✓ ({ts_result.get('row_count', len(ts_result['rows']))} rows)")
                    elif "tables" in ts_result:
                        print(f"  TypeScript: ✓ ({len(ts_result['tables'])} tables)")
                    elif "schemas" in ts_result:
                        print(f"  TypeScript: ✓ ({len(ts_result['schemas'])} schemas)")
                    elif "columns" in ts_result:
                        print(f"  TypeScript: ✓ ({len(ts_result['columns'])} columns)")
                    else:
                        print(f"  TypeScript: ✓")
                
                if py_server:
                    py_result = py_server.call_tool(tool_name, args)
                    result.python_result = py_result
                    
                    if "error" in py_result:
                        print(f"  Python: ⚠ {py_result['error']}")
                    else:
                        print(f"  Python: ✓")
                    
                    # Compare results
                    differences = compare_results(py_result, ts_result)
                    result.differences = differences
                    if differences:
                        print(f"  Differences: {differences}")
                        result.success = False
                    else:
                        print(f"  ✓ Results match")
                
            except Exception as e:
                result.success = False
                result.error = str(e)
                print(f"  ✗ Error: {e}")
            
            results.append(result)
        
    finally:
        print("\n--- Stopping servers ---")
        ts_server.stop()
        print(f"  ✓ TypeScript server stopped")
        if py_server:
            py_server.stop()
            print(f"  ✓ Python server stopped")
    
    return results


def print_summary(results: list[TestResult]) -> bool:
    """Print summary and return True if all tests passed"""
    print("\n" + "=" * 60)
    print("EVALUATION SUMMARY")
    print("=" * 60)
    
    passed = sum(1 for r in results if r.success)
    failed = len(results) - passed
    
    print(f"\nTotal tests: {len(results)}")
    print(f"Passed: {passed}")
    print(f"Failed: {failed}")
    
    if failed > 0:
        print("\nFailed tests:")
        for r in results:
            if not r.success:
                print(f"  - {r.tool_name}")
                if r.error:
                    print(f"    Error: {r.error}")
                if r.differences:
                    for d in r.differences:
                        print(f"    Diff: {d}")
    
    return failed == 0


def check_docker_running() -> bool:
    """Check if Docker container is running"""
    try:
        result = subprocess.run(
            ["docker", "ps", "--filter", "name=postgresql-mcp-test", "--format", "{{.Names}}"],
            capture_output=True,
            text=True,
        )
        return "postgresql-mcp-test" in result.stdout
    except Exception:
        return False


def start_docker(repo_root: Path) -> bool:
    """Start Docker container"""
    print("Starting PostgreSQL container...")
    result = subprocess.run(
        ["docker-compose", "up", "-d"],
        cwd=repo_root,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        print(f"Failed to start container: {result.stderr}")
        return False
    return True


def main():
    parser = argparse.ArgumentParser(description="Evaluate PostgreSQL MCP servers")
    parser.add_argument("--ts-only", action="store_true", help="Only test TypeScript version")
    parser.add_argument("--no-docker", action="store_true", help="Don't start Docker automatically")
    args = parser.parse_args()
    
    # Determine paths
    script_dir = Path(__file__).parent.parent
    ts_dist = script_dir / "typescript" / "dist" / "index.js"
    python_dir = script_dir / "python"
    
    if not ts_dist.exists():
        print(f"Error: TypeScript build not found at {ts_dist}")
        print("Run: cd typescript && npm run build")
        sys.exit(1)
    
    # Database configuration (matches docker-compose.yml)
    db_config = {
        "host": "localhost",
        "port": 5433,
        "user": "testuser",
        "password": "testpass",
        "db": "testdb",
    }
    
    # Check/start Docker
    if not args.no_docker:
        if not check_docker_running():
            if not start_docker(script_dir):
                print("Error: Could not start PostgreSQL container")
                print("Run manually: docker-compose up -d")
                sys.exit(1)
        
        # Wait for PostgreSQL to be ready
        print(f"Waiting for PostgreSQL on port {db_config['port']}...")
        if not wait_for_postgres(
            db_config["host"],
            db_config["port"],
            db_config["user"],
            db_config["password"],
            db_config["db"],
        ):
            print("Error: PostgreSQL did not become ready in time")
            sys.exit(1)
        print("  ✓ PostgreSQL is ready")
    
    # Build environment for MCP servers
    env = {
        "POSTGRES_HOST": db_config["host"],
        "POSTGRES_PORT": str(db_config["port"]),
        "POSTGRES_USER": db_config["user"],
        "POSTGRES_PASSWORD": db_config["password"],
        "POSTGRES_DB": db_config["db"],
        "POSTGRES_SSLMODE": "disable",
    }
    
    # Commands to start servers
    typescript_cmd = ["node", str(ts_dist)]
    python_cmd = ["uv", "run", "python", "-m", "postgres_mcp.server"]
    
    print("=" * 60)
    print("POSTGRESQL MCP EVALUATION")
    print("=" * 60)
    print(f"\nDatabase: {db_config['host']}:{db_config['port']}/{db_config['db']}")
    print(f"TypeScript: {ts_dist}")
    if not args.ts_only:
        print(f"Python: {python_dir}")
    
    try:
        results = run_evaluation(
            python_cmd=python_cmd,
            typescript_cmd=typescript_cmd,
            env=env,
            python_cwd=str(python_dir),
            ts_only=args.ts_only,
        )
        
        success = print_summary(results)
        sys.exit(0 if success else 1)
    except KeyboardInterrupt:
        print("\nInterrupted by user")
        sys.exit(130)


if __name__ == "__main__":
    main()

