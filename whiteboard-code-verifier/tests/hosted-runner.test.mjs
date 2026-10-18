import test from 'node:test';
import assert from 'node:assert/strict';
import { hostedRunnerConfiguration, hostedRunnerHealth, runHostedProgram } from '../server/hosted-runner.mjs';

const env = { WANDBOX_API_URL: 'https://compiler.example/api' };
const readHeader = async () => '/* curated */';

test('hosted runner sends code, input, and teaching headers to C compiler', async () => {
  let request;
  const result = await runHostedProgram({ source: '#include "stack.h"\nint main(void) { return 0; }', stdin: '2\n' }, {
    env, fetchImpl: async (url, options) => {
      request = { url, options };
      return new Response(JSON.stringify({ status: '0', signal: '', compiler_output: '', compiler_error: '',
        program_output: 'ok\n', program_error: '' }), { status: 200 });
    },
  });
  assert.equal(request.url, `${env.WANDBOX_API_URL}/compile.json`);
  const payload = JSON.parse(request.options.body);
  assert.equal(payload.compiler, 'gcc-head');
  assert.equal(payload.stdin, '2\n');
  assert.equal(payload['compiler-option-raw'], '-I. -std=c++17');
  assert.deepEqual(payload.codes.map((file) => file.file), ['stack.h', 'linked_list.h', 'queue.h', 'search.h', 'board_contract.h']);
  assert.match(payload.codes.find((file) => file.file === 'queue.h').code, /#include "board_contract.h"/);
  assert.match(payload.codes.find((file) => file.file === 'board_contract.h').code, /#ifndef/);
  assert.equal(result.status, 'success');
  assert.equal(result.stdout, 'ok\n');
});

test('hosted runner maps compiler errors to board diagnostics', async () => {
  const result = await runHostedProgram({ source: 'int main(void) { return 0 }' }, {
    env, readHeader, fetchImpl: async () => new Response(JSON.stringify({
      status: '1', signal: '', compiler_output: '', compiler_error: 'prog.cc:1:27: error: expected ‘;’ before ‘}’ token\n',
      program_output: '', program_error: '',
    }), { status: 200 }),
  });
  assert.equal(result.status, 'compile_error');
  assert.deepEqual(result.diagnostics[0], { line: 1, column: 27, severity: 'error',
    message: 'expected ‘;’ before ‘}’ token', kind: 'compiler' });
  assert.equal(result.exitCode, null);
});

test('hosted runner refuses invalid input and non-HTTPS compiler configuration', async () => {
  assert.equal(hostedRunnerConfiguration({ WANDBOX_API_URL: 'http://compiler.example' }).available, false);
  await assert.rejects(runHostedProgram({ source: ' ', stdin: '' }, { env }), { status: 400 });
  await assert.rejects(runHostedProgram({ source: 'int main(){}', stdin: 'x'.repeat(8193) }, { env }), { status: 400 });
});

test('hosted health checks that the compiler offers C', async () => {
  const available = await hostedRunnerHealth({ env, fetchImpl: async () =>
    new Response(JSON.stringify([{ name: 'gcc-head' }]), { status: 200 }) });
  assert.equal(available.available, true);
  const unavailable = await hostedRunnerHealth({ env, fetchImpl: async () =>
    new Response(JSON.stringify([{ name: 'cpython' }]), { status: 200 }) });
  assert.equal(unavailable.available, false);
});

test('hosted runner surfaces compiler rate limits without claiming a run completed', async () => {
  await assert.rejects(runHostedProgram({ source: 'int main(void) { return 0; }' }, {
    env, readHeader, fetchImpl: async () => new Response('', { status: 429 }),
  }), { status: 429 });
});

test('hosted Python uses its runtime without C headers or flags and preserves stdin', async () => {
  let payload;
  const result = await runHostedProgram({ source: 'print(input())\n', stdin: 'hello\n', language: 'python' }, {
    env, readHeader: async () => { throw new Error('Python must not read C headers'); },
    fetchImpl: async (_url, options) => {
      payload = JSON.parse(options.body);
      return new Response(JSON.stringify({ status: '0', compiler_output: '', compiler_error: '', program_output: 'hello\n', program_error: '' }));
    },
  });
  assert.equal(payload.compiler, 'cpython-3.13.8');
  assert.deepEqual(payload.codes, []);
  assert.equal(payload['compiler-option-raw'], undefined);
  assert.equal(payload.stdin, 'hello\n');
  assert.equal(result.language, 'python');
  assert.equal(result.stdout, 'hello\n');
});

test('hosted Python classifies syntax errors and maps runtime tracebacks', async () => {
  for (const [message, status] of [['SyntaxError: expected colon', 'compile_error'], ['ZeroDivisionError: division by zero', 'runtime_error']]) {
    const result = await runHostedProgram({ source: 'broken', language: 'python' }, { env,
      fetchImpl: async () => new Response(JSON.stringify({ status: '1', compiler_output: '', compiler_error: '', program_output: '',
        program_error: `Traceback (most recent call last):\n  File "prog.py", line 3, in <module>\n${message}\n` })),
    });
    assert.equal(result.status, status);
    assert.equal(result.diagnostics[0].line, 3);
    assert.equal(result.diagnostics[0].message, message);
  }
  const ready = await hostedRunnerHealth({ env, language: 'python', fetchImpl: async () => new Response(JSON.stringify([{ name: 'cpython-3.13.8' }])) });
  assert.equal(ready.available, true);
  const wrong = await hostedRunnerHealth({ env, language: 'python', fetchImpl: async () => new Response(JSON.stringify([{ name: 'gcc-head' }])) });
  assert.equal(wrong.available, false);
});
