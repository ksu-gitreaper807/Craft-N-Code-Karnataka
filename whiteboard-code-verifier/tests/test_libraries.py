"""Trusted fixtures exercise public header APIs with GCC and sanitizers."""

from pathlib import Path
import shutil
import unittest

from test_runner import execute_fixture, runner

ROOT = Path(__file__).resolve().parents[1]


@unittest.skipUnless(shutil.which("g++"), "GCC is required")
class LibraryTests(unittest.TestCase):
    def test_operations_boundaries_wraparound_growth_and_cleanup(self):
        source = (ROOT / "tests/fixtures/library_checks.c").read_text()
        result = execute_fixture({"source": source})
        self.assertEqual(result["status"], "success", result)
        self.assertEqual(result["compilerOutput"], "", result)
        self.assertEqual(result["stderr"], "[stack] grow 0 -> 4 ints\n", result)

    def test_contracts_report_the_public_callsite(self):
        cases = [
            ("linked_list.h", "LinkedList x; list_init(&x);", "list_pop_front(&x)", "pop on empty list"),
            ("linked_list.h", "LinkedList x; list_init(&x);", "list_front(&x)", "front on empty list"),
            ("linked_list.h", "LinkedList x; list_init(&x);", "list_insert(&x, 1, 4)", "index out of bounds"),
            ("linked_list.h", "LinkedList x; list_init(&x);", "list_erase(&x, 0)", "index out of bounds"),
            ("queue.h", "Queue x; queue_init(&x);", "queue_pop(&x)", "pop on empty queue"),
            ("queue.h", "Queue x; queue_init(&x);", "queue_front(&x)", "front on empty queue"),
            ("search.h", "", "binary_search(NULL, 1, 7)", "valid pointer"),
            ("search.h", "", "upper_bound(NULL, 1, 7)", "valid pointer"),
            ("search.h", "", "binary_search(NULL, (size_t)PTRDIFF_MAX + 1, 7)", "index range"),
        ]
        for header, setup, operation, message in cases:
            with self.subTest(operation=operation):
                source = f"#include <{header}>\nint main(void) {{ {setup}\n    {operation};\n}}"
                result = execute_fixture({"source": source})
                self.assertEqual(result["status"], "runtime_error", result)
                self.assertEqual(result["exitCode"], 2, result)
                self.assertEqual(result["diagnostics"][0]["line"], 3, result)
                self.assertEqual(result["diagnostics"][0]["kind"], "contract", result)
                self.assertIn(message, result["diagnostics"][0]["message"])

    def test_teaching_search_and_stl_algorithms_can_be_included_together(self):
        source = '#include <search.h>\n#include <algorithm>\n#include <vector>\nint main() { int a[]{1,2,3}; std::vector<int> v{1,2,3}; return binary_search(a,3,2)!=1 || !std::binary_search(v.begin(),v.end(),2); }'
        result = execute_fixture({'source': source})
        self.assertEqual(result['status'], 'success', result)

    def test_only_public_library_headers_are_allowed(self):
        for header in ["linked_list.h", "queue.h", "search.h"]:
            self.assertIsNone(runner.validate_source(f"#include <{header}>\nint main(void) {{}}"))
        self.assertIsNotNone(runner.validate_source("#include <board_contract.h>\nint main(void) {}"))


if __name__ == "__main__":
    unittest.main()
