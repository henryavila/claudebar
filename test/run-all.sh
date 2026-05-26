#!/usr/bin/env bash
# Run all tests: unit tests first, then every fixture in test/fixtures/.
set -uo pipefail

# Frozen "now" for deterministic countdown snapshots across all fixtures.
# 1830000000 = 2027-12-26 22:40:00 UTC (arbitrary anchor; only deltas matter).
# Every fixture's resets_at is computed as FROZEN_NOW + offset, so the
# rendered countdown is reproducible regardless of when the suite runs.
export CLAUDEBAR_NOW_FOR_TESTING=1830000000

# Frozen branch name — `git branch --show-current` would otherwise leak the
# CI/dev branch into expected outputs and break tests on feature branches.
export CLAUDEBAR_BRANCH_FOR_TESTING=main

dir="$(cd "$(dirname "$0")" && pwd)"
pass=0
fail=0
failed_names=()

# Unit tests
for t in "$dir"/unit/test-*.sh; do
    [[ -f "$t" ]] || continue
    if bash "$t"; then
        pass=$((pass+1))
    else
        fail=$((fail+1))
        failed_names+=("unit:$(basename "$t")")
    fi
done

# Fixture/integration tests
for fixture in "$dir"/fixtures/*.json; do
    name=$(basename "$fixture" .json)
    if "$dir/run-fixture.sh" "$name" > /dev/null 2>&1; then
        echo "PASS: $name"
        pass=$((pass+1))
    else
        echo "FAIL: $name"
        "$dir/run-fixture.sh" "$name" || true
        fail=$((fail+1))
        failed_names+=("fixture:$name")
    fi
done

echo
echo "─── Summary ───"
echo "Passed: $pass"
echo "Failed: $fail"
if (( fail > 0 )); then
    printf '  - %s\n' "${failed_names[@]}"
    exit 1
fi
