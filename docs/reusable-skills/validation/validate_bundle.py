"""Validate skill structure, portable references, scenarios and optional official checks.

Usage: python -X utf8 validation/validate_bundle.py [--official PATH]
Only reads artifacts and prints a JSON report; does not modify the product.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import subprocess


def validate(root: Path, official: Path | None) -> dict:
    problems: list[str] = []
    results: list[dict] = []
    names = set()
    skill_dirs = sorted(p for p in (root / "skills").iterdir() if p.is_dir())
    for folder in skill_dirs:
        errors: list[str] = []
        entry = folder / "SKILL.md"
        case = folder / "references" / "case-study.md"
        scenarios = folder / "evals" / "evals.json"
        required = [entry, case, scenarios]
        for path in required:
            if not path.is_file():
                errors.append(f"Missing {path.relative_to(folder)}")
        text = entry.read_text(encoding="utf-8") if entry.is_file() else ""
        header = re.match(r"\A---\n(.*?)\n---\n", text, re.S)
        if not header:
            errors.append("Missing YAML frontmatter")
        else:
            name = re.search(r"^name:\s*(\S+)\s*$", header[1], re.M)
            description = re.search(r"^description:\s*(.+)$", header[1], re.M)
            if not name or name[1] != folder.name:
                errors.append("Name does not match directory")
            if not description:
                errors.append("Missing description")
            if name:
                if name[1] in names:
                    errors.append("Duplicate skill name")
                names.add(name[1])
        if len(text.splitlines()) > 500:
            errors.append("SKILL.md exceeds 500 lines")
        for section in ["输入", "执行流程", "检查清单", "输出格式"]:
            if section not in text:
                errors.append(f"Missing workflow section: {section}")
        # Each skill must be usable after copying only its own directory.
        for md in folder.rglob("*.md"):
            contents = md.read_text(encoding="utf-8")
            for target in re.findall(r"\[[^\]]+\]\(([^)]+)\)", contents):
                if re.match(r"[a-zA-Z][a-zA-Z0-9+.-]*:", target):
                    errors.append(f"External dependency link in {md.name}: {target}")
                    continue
                target = target.split("#", 1)[0]
                if not target:
                    continue
                resolved = (md.parent / target).resolve()
                if not resolved.is_relative_to(folder.resolve()):
                    errors.append(f"Reference leaves skill directory: {target}")
                elif not resolved.is_file():
                    errors.append(f"Broken reference: {target}")
        eval_count = 0
        if scenarios.is_file():
            try:
                data = json.loads(scenarios.read_text(encoding="utf-8"))
                if data.get("skill_name") != folder.name:
                    errors.append("Eval skill_name mismatch")
                evals = data["evals"]
                eval_count = len(evals)
                if eval_count < 2:
                    errors.append("Fewer than two migration scenarios")
                ids = [e["id"] for e in evals]
                if len(ids) != len(set(ids)):
                    errors.append("Duplicate eval IDs")
                for e in evals:
                    for key in ["prompt", "expected_output"]:
                        if not isinstance(e.get(key), str) or not e[key].strip():
                            errors.append(f"Invalid eval field: {key}")
                    if not isinstance(e.get("files"), list):
                        errors.append("Eval files must be a list")
            except (KeyError, TypeError, ValueError) as exc:
                errors.append(f"Invalid eval JSON: {exc}")
        official_result = "not_requested"
        if official is not None:
            import sys
            run = subprocess.run(
                [sys.executable, "-X", "utf8", str(official), str(folder)],
                capture_output=True, text=True, encoding="utf-8", timeout=30,
                env={**os.environ, "PYTHONUTF8": "1"},
            )
            official_result = run.stdout.strip() or run.stderr.strip()
            if run.returncode:
                errors.append(f"Official validator failed: {official_result}")
        results.append({"name": folder.name, "passed": not errors,
                        "lines": len(text.splitlines()), "scenarios": eval_count,
                        "official": official_result, "errors": errors})
    if len(results) != 12:
        problems.append(f"Expected 12 skills, found {len(results)}")
    # Top-level and validation Markdown may link within the bundle, not into the repo.
    for md in list(root.glob("*.md")) + list((root / "validation").rglob("*.md")):
        for target in re.findall(r"\[[^\]]+\]\(([^)]+)\)", md.read_text(encoding="utf-8")):
            if re.match(r"[a-zA-Z][a-zA-Z0-9+.-]*:", target):
                continue
            target = target.split("#", 1)[0]
            if not target:
                continue
            resolved = (md.parent / target).resolve()
            if not resolved.is_relative_to(root.resolve()) or not resolved.is_file():
                problems.append(f"Broken/nonportable link in {md.relative_to(root)}: {target}")
    return {"kind": "structural_validation_not_behavioral_proof", "skill_count": len(results),
            "scenario_count": sum(r["scenarios"] for r in results),
            "passed": not problems and all(r["passed"] for r in results),
            "problems": problems, "skills": results}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--official", type=Path)
    args = parser.parse_args()
    report = validate(args.root.resolve(), args.official)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    raise SystemExit(0 if report["passed"] else 1)
