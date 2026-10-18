"""Only fixed, trusted C/Python fixtures run on the test host; app requests require Docker."""

import importlib.util
from pathlib import Path
import shutil
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("board_runner", ROOT / "runner/runner.py")
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


def execute_fixture(payload):
    # ASan and UBSan stay enabled. Host ptrace restrictions can block LSan's tracer.
    # The container entrypoint always uses execute's detect_leaks=True default.
    return runner.execute(payload, detect_leaks=False)


class ParsingTests(unittest.TestCase):
    def test_teaching_notes_cover_memory_and_input_without_reading_comments_or_strings(self):
        source = ('// memcpy(fake)\nchar *message = "fgets(fake)";\n'
                  'void *next = realloc(ptr, 32);\nfgets(line, sizeof line, stdin);\nmemcpy(dst, src, 4);')
        titles = [note['title'] for note in runner.teaching_notes(source)]
        self.assertIn('Keep the old allocation on failure', titles)
        self.assertIn('Bounded line input', titles)
        self.assertIn('Copies need valid ranges', titles)
        self.assertEqual(sum(title == 'Copies need valid ranges' for title in titles), 1)
        self.assertEqual(runner.teaching_notes('std::binary_search(a.begin(), a.end(), 3);'), [])

    def test_rejects_untrusted_include_forms(self):
        for source in ['#include "/etc/passwd"', '#include </etc/passwd>', '#include HEADER',
                       '#include_next <stdio.h>', '#import <stdio.h>', '#embed "/etc/passwd"',
                       '#inc\\\nlude "/etc/passwd"']:
            with self.subTest(source=source):
                self.assertIsNotNone(runner.validate_source(source))
        self.assertIsNone(runner.validate_source('/* #include "fake" */\n#include <stdio.h>\nint main(void) {}'))

    def test_parse_compiler_and_runtime_diagnostics(self):
        compiler = 'board.c:4:12: error: expected semicolon\nboard.c:3:2: warning: unused variable\n'
        diagnostics = runner.parse_diagnostics(compiler, '')
        self.assertEqual([d['line'] for d in diagnostics], [4, 3])
        self.assertEqual(diagnostics[1]['severity'], 'warning')
        trace = 'ERROR: AddressSanitizer: heap-use-after-free\n#0 fn /opt/lib/stack.h:10:2\n#1 main /tmp/board/board.c:7:4\n'
        diagnostics = runner.parse_diagnostics('', trace)
        self.assertEqual(diagnostics[0]['line'], 7)
        self.assertEqual(diagnostics[0]['message'], 'heap-use-after-free')


@unittest.skipUnless(shutil.which('g++'), 'GCC is required for trusted integration fixtures')
class CompilerTests(unittest.TestCase):
    def test_cpp17_stl_and_cpp_diagnostics(self):
        source = '#include <iostream>\n#include <vector>\n#include <algorithm>\nint main() { std::vector<int> v{3,1,2}; std::sort(v.begin(), v.end()); for (auto n : v) std::cout << n; }'
        result = execute_fixture({'source': source})
        self.assertEqual(result['status'], 'success', result)
        self.assertEqual(result['stdout'], '123')
        bad = execute_fixture({'source': '#include <iostream>\nint main() {\n unknown_symbol;\n} '})
        self.assertEqual(bad['status'], 'compile_error', bad)
        self.assertIn('board.cpp:3:', bad['compilerOutput'])
        self.assertEqual(bad['diagnostics'][0]['line'], 3)

    def test_real_stdin_and_stdout(self):
        result = execute_fixture({'source': '#include <stdio.h>\nint main(void) { int a,b; if(scanf("%d %d",&a,&b)!=2) return 1; printf("%d\\n",a+b); }', 'stdin': '3 5\n'})
        self.assertEqual(result['status'], 'success', result)
        self.assertEqual(result['stdout'], '8\n')

    def test_compile_error_keeps_blank_lines(self):
        result = execute_fixture({'source': 'int main(void) {\n\n    unknown_symbol;\n}\n'})
        self.assertEqual(result['status'], 'compile_error', result)
        self.assertEqual(result['diagnostics'][0]['line'], 3)

    def test_asan_reports_actual_use_after_free(self):
        source = '#include <stdlib.h>\nint main(void) {\n int *p = (int *)malloc(sizeof *p);\n if(!p) return 1;\n *p = 42;\n free(p);\n return *p;\n}\n'
        result = execute_fixture({'source': source})
        self.assertEqual(result['status'], 'runtime_error', result)
        self.assertIn('heap-use-after-free', result['stderr'])
        self.assertTrue(any(d['line'] == 7 for d in result['diagnostics']), result)

    def test_ubsan_reports_integer_overflow(self):
        source = '#include <limits.h>\nint main(void) { volatile int x = INT_MAX; return x + 1; }'
        result = execute_fixture({'source': source})
        self.assertEqual(result['status'], 'runtime_error', result)
        self.assertIn('signed integer overflow', result['stderr'])

    def test_stack_contract_is_attributed_to_teacher_line(self):
        source = '#include <stack.h>\nint main(void) {\n Stack s;\n stack_init(&s);\n stack_pop(&s);\n}'
        result = execute_fixture({'source': source})
        self.assertEqual(result['status'], 'runtime_error', result)
        self.assertEqual(result['exitCode'], 2)
        self.assertTrue(any(d['line'] == 5 and d['kind'] == 'contract' for d in result['diagnostics']), result)

    def test_stack_success_and_cleanup(self):
        source = '#include <stack.h>\nint main(void) { Stack s; stack_init(&s); stack_push(&s,42); int v=stack_pop(&s); stack_free(&s); return v!=42; }'
        self.assertEqual(execute_fixture({'source': source})['status'], 'success')

    def test_eof_does_not_hang(self):
        source = '#include <stdio.h>\nint main(void) { int x; return scanf("%d", &x) == EOF ? 0 : 1; }'
        self.assertEqual(execute_fixture({'source': source})['status'], 'success')

    def test_infinite_loop_is_stopped(self):
        result = execute_fixture({'source': 'int main(void) { for(;;) {} }'})
        self.assertEqual(result['status'], 'timeout', result)
        self.assertLess(result['durationMs'], 7000)

    def test_output_is_bounded(self):
        source = '#include <stdio.h>\nint main(void) { for(int i=0;i<100000;i++) puts("lots of output"); }'
        result = execute_fixture({'source': source})
        self.assertEqual(result['status'], 'output_limit', result)
        self.assertLessEqual(len(result['stdout']), runner.OUTPUT_LIMIT)

    def test_leak_sanitizer_when_tracing_is_available(self):
        source = '#include <stdlib.h>\nint main(void) { void *p=malloc(64); if(!p) return 1; *(char *)p=1; p=NULL; return 0; }'
        result = runner.execute({'source': source})
        if 'LeakSanitizer has encountered a fatal error' in result['stderr']:
            self.skipTest('Host blocks LeakSanitizer tracing; verify inside the Docker runner')
        self.assertEqual(result['status'], 'runtime_error', result)
        self.assertIn('detected memory leaks', result['stderr'])


if __name__ == '__main__':
    unittest.main()


class PythonTests(unittest.TestCase):
    def run_python(self, source, stdin=""):
        return execute_fixture({"source": source, "stdin": stdin, "language": "python"})

    def test_python_input_blank_lines_and_standard_library(self):
        source = 'from collections import deque\n\na, b = map(int, input().split())\nq = deque([a, b])\nprint(sum(q))\n'
        result = self.run_python(source, '3 5\n\n')
        self.assertEqual(result['status'], 'success', result)
        self.assertEqual(result['stdout'], '8\n')
        self.assertEqual(result['notes'], [])

    def test_python_syntax_and_indentation_errors_keep_board_line_numbers(self):
        for source in ['\n\nif True\n    print(1)\n', '\nif True:\nprint(1)\n']:
            with self.subTest(source=source):
                result = self.run_python(source)
                self.assertEqual(result['status'], 'compile_error', result)
                self.assertEqual(result['diagnostics'][0]['line'], 3)
                self.assertEqual(result['diagnostics'][0]['kind'], 'compiler')
                self.assertEqual(result['stdout'], '')

    def test_python_tracebacks_and_eof_are_real(self):
        result = self.run_python('def divide():\n    return 1 / 0\n\ndivide()\n')
        self.assertEqual(result['status'], 'runtime_error', result)
        self.assertEqual({d['line'] for d in result['diagnostics']}, {2, 4})
        self.assertIn('ZeroDivisionError', result['diagnostics'][0]['message'])
        eof = self.run_python('input()\n')
        self.assertEqual(eof['status'], 'runtime_error', eof)
        self.assertIn('EOFError', eof['stderr'])

    def test_python_time_and_output_limits(self):
        timed = self.run_python('while True:\n    pass\n')
        self.assertEqual(timed['status'], 'timeout', timed)
        output = self.run_python('print("x" * 40000)\n')
        self.assertEqual(output['status'], 'output_limit', output)
        self.assertLessEqual(len(output['stdout']), 16384)

    def test_unknown_language_is_rejected(self):
        result = execute_fixture({'source': 'print(1)', 'language': 'javascript'})
        self.assertEqual(result['status'], 'invalid_source')
        self.assertIn('C++ or Python', result['stderr'])
