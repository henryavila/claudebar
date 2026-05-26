#!/usr/bin/env bash
# Run all tests: unit tests first, then every fixture in test/fixtures/.
set -uo pipefail

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
