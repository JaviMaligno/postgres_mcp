"""Validate an MCP Registry server manifest against its declared schema."""

import json
import sys
from pathlib import Path
from urllib.request import urlopen

from jsonschema.validators import validator_for


def validate_manifest(manifest_path: Path) -> None:
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    schema_url = manifest["$schema"]
    with urlopen(schema_url, timeout=30) as response:  # noqa: S310 - schema URL is manifest-controlled in CI
        schema = json.load(response)

    validator_class = validator_for(schema)
    validator_class.check_schema(schema)
    errors = sorted(
        validator_class(schema).iter_errors(manifest),
        key=lambda error: list(error.path),
    )
    if errors:
        details = "\n".join(
            f"- {'/'.join(map(str, error.path)) or '<root>'}: {error.message}"
            for error in errors
        )
        raise ValueError(f"Invalid MCP server manifest:\n{details}")


if __name__ == "__main__":
    path = Path(sys.argv[1] if len(sys.argv) > 1 else "../server.json")
    validate_manifest(path)
    print(f"Valid MCP server manifest: {path}")
