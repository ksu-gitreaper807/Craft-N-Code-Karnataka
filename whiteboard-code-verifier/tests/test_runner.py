"""Only fixed, trusted C fixtures run on the test host; app requests require Docker."""

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


@unittest.skipUnless(shutil.which('gcc'), 'GCC is required for trusted integration fixtures')
class CompilerTests(unittest.TestCase):
    def test_real_stdin_and_stdout(self):
        result = execute_fixture({'source': '#include <stdio.h>\nint main(void) { int a,b; if(scanf("%d %d",&a,&b)!=2) return 1; printf("%d\\n",a+b); }', 'stdin': '3 5\n'})
        self.assertEqual(result['status'], 'success', result)
        self.assertEqual(result['stdout'], '8\n')

    def test_compile_error_keeps_blank_lines(self):
        result = execute_fixture({'source': 'int main(void) {\n\n    unknown_symbol;\n}\n'})
        self.assertEqual(result['status'], 'compile_error', result)
        self.assertEqual(result['diagnostics'][0]['line'], 3)

    def test_asan_reports_actual_use_after_free(self):
        source = '#include <stdlib.h>\nint main(void) {\n int *p = malloc(sizeof *p);\n if(!p) return 1;\n *p = 42;\n free(p);\n return *p;\n}\n'
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
