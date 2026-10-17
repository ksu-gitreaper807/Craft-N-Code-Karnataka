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
  assert.equal(payload.compiler, 'gcc-head-c');
  assert.equal(payload.stdin, '2\n');
  assert.equal(payload['compiler-option-raw'], '-I.');
  assert.deepEqual(payload.codes.map((file) => file.file), ['stack.h', 'linked_list.h', 'queue.h', 'search.h', 'board_contract.h']);
  assert.match(payload.codes.find((file) => file.file === 'queue.h').code, /#include "board_contract.h"/);
  assert.match(payload.codes.find((file) => file.file === 'board_contract.h').code, /#ifndef/);
  assert.equal(result.status, 'success');
  assert.equal(result.stdout, 'ok\n');
});

test('hosted runner maps compiler errors to board diagnostics', async () => {
  const result = await runHostedProgram({ source: 'int main(void) { return 0 }' }, {
    env, readHeader, fetchImpl: async () => new Response(JSON.stringify({
      status: '1', signal: '', compiler_output: '', compiler_error: 'prog.c:1:27: error: expected ‘;’ before ‘}’ token\n',
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
    new Response(JSON.stringify([{ name: 'gcc-head-c' }]), { status: 200 }) });
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
