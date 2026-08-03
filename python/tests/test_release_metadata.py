import json
from pathlib import Path

try:  # tomllib is stdlib from 3.11; the project still supports 3.10
    import tomllib
except ModuleNotFoundError:  # pragma: no cover - only taken on Python 3.10
    import tomli as tomllib

from postgres_mcp.__version__ import __version__


ROOT = Path(__file__).resolve().parents[2]
SERVER_NAME = "io.github.JaviMaligno/postgresql"
RELEASE_VERSION = "1.1.0"


def test_package_versions_and_registry_ownership_are_aligned():
    pyproject = tomllib.loads(
        (ROOT / "python" / "pyproject.toml").read_text(encoding="utf-8")
    )
    package_json = json.loads(
        (ROOT / "typescript" / "package.json").read_text(encoding="utf-8")
    )
    python_readme = (ROOT / "python" / "README.md").read_text(encoding="utf-8")

    assert __version__ == RELEASE_VERSION
    assert pyproject["project"]["version"] == RELEASE_VERSION
    assert package_json["version"] == RELEASE_VERSION
    assert package_json["mcpName"] == SERVER_NAME
    assert f"<!-- mcp-name: {SERVER_NAME} -->" in python_readme


def test_root_manifest_describes_both_packages_and_multidatabase_configuration():
    assert not (ROOT / "python" / "server.json").exists()

    manifest = json.loads((ROOT / "server.json").read_text(encoding="utf-8"))
    assert (
        manifest["$schema"]
        == "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json"
    )
    assert manifest["name"] == SERVER_NAME
    assert manifest["version"] == RELEASE_VERSION
    assert len(manifest["description"]) <= 100

    packages = {package["registryType"]: package for package in manifest["packages"]}
    assert set(packages) == {"npm", "pypi"}
    for package in packages.values():
        assert package["identifier"] == "postgresql-mcp"
        assert package["version"] == RELEASE_VERSION
        variables = {
            variable["name"]: variable for variable in package["environmentVariables"]
        }
        assert variables["POSTGRES_CONNECTIONS"]["isRequired"] is False
        assert variables["POSTGRES_CONNECTIONS"]["isSecret"] is True
        assert variables["POSTGRES_PASSWORD"]["isRequired"] is False
        assert variables["POSTGRES_PASSWORD"]["isSecret"] is True
        assert variables["POSTGRES_USER"]["isRequired"] is False
        assert variables["POSTGRES_DB"]["isRequired"] is False


def test_publish_workflow_runs_database_tests_and_validates_manifest():
    workflow = (ROOT / ".github" / "workflows" / "publish.yml").read_text(
        encoding="utf-8"
    )

    assert "pytest -v --run-integration" in workflow
    assert "Validate server.json" in workflow
    # --run-integration is worthless without the fixtures those tests query:
    # the first tagged release failed here because the schema was never seeded.
    assert "scripts/init_sample_db.sql" in workflow
