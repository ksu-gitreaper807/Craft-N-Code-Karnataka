"""Exercise the actual demo sources through board extraction and the real compiler."""

import json
from pathlib import Path
import shutil
import subprocess
import unittest

from test_runner import execute_fixture

ROOT = Path(__file__).resolve().parents[1]
EXTRACT_LESSONS = """
import { lessons } from './src/lessons.js';
import { extractProgram, INPUT_COLOR } from './src/board.js';
const fixtures = lessons.map(lesson => {
  const elements = [
    { type: 'text', id: 'code', frameId: 'frame', text: lesson.source,
      strokeColor: '#1e1e1e', x: 80, y: 100, width: 600, fontSize: 18, lineHeight: 1.25 },
    ...(lesson.stdin ? [{ type: 'text', id: 'input', frameId: 'frame', text: lesson.stdin,
      strokeColor: INPUT_COLOR, x: 80, y: 510, width: 60, fontSize: 18 }] : []),
  ];
  return { id: lesson.id, expectedStdout: lesson.expectedStdout, ...extractProgram(elements, 'frame') };
});
console.log(JSON.stringify(fixtures));
"""


@unittest.skipUnless(shutil.which('node') and shutil.which('g++'), 'Node and GCC required')
class DemoFlowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        extraction = subprocess.run(
            ['node', '--input-type=module', '-e', EXTRACT_LESSONS], cwd=ROOT,
            capture_output=True, text=True, check=True, timeout=5,
        )
        cls.programs = {item['id']: item for item in json.loads(extraction.stdout)}

    def test_cpp_standard_library_examples(self):
        for lesson_id, program in self.programs.items():
            if not lesson_id.startswith('cpp-'):
                continue
            with self.subTest(lesson=lesson_id):
                result = execute_fixture(program)
                self.assertEqual(result['status'], 'success', result)
                self.assertEqual(result['stdout'], program['expectedStdout'])

    def test_input_output_lesson(self):
        result = execute_fixture(self.programs['sum'])
        self.assertEqual(result['status'], 'success', result)
        self.assertEqual(result['stdout'], '3 + 5 = 8\n')

    def test_memory_lesson_maps_real_diagnostics(self):
        program = self.programs['memory']
        result = execute_fixture(program)
        self.assertEqual(result['status'], 'runtime_error', result)
        self.assertIn('heap-use-after-free', result['stderr'])
        self.assertIn('Pointer on stack: 0x', result['stdout'])
        self.assertIn('Buffer address: 0x', result['stdout'])
        self.assertTrue(result['diagnostics'])
        for diagnostic in result['diagnostics']:
            self.assertEqual(program['lineMap'][diagnostic['line'] - 1]['elementId'], 'code')

    def test_stack_lesson_maps_contract_to_pop(self):
        program = self.programs['stack']
        result = execute_fixture(program)
        self.assertEqual(result['status'], 'runtime_error', result)
        contract = next(d for d in result['diagnostics'] if d['kind'] == 'contract')
        self.assertIn('stack_pop', program['source'].split('\n')[contract['line'] - 1])
        self.assertEqual(program['lineMap'][contract['line'] - 1]['elementId'], 'code')
