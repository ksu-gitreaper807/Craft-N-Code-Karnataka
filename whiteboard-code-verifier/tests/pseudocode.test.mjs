import test from 'node:test';
import assert from 'node:assert/strict';
import { assistPseudocode, validatePseudocode, validatePseudocodeResult } from '../server/pseudocode.mjs';

const env = { GEMINI_API_KEY: 'private-unit-key', OCR_MODEL: 'test-model' };
const proposal = { source: '#include <stdio.h>\nint main(void) { puts("5"); return 0; }', explanation: 'Completed the C program.', issues: [{ line: 1, message: 'Added the missing entry point.' }] };
const reply = (value) => new Response(JSON.stringify({ status: 'completed', usage: { total_tokens: 10, private: env.GEMINI_API_KEY },
  steps: [{ type: 'model_output', content: [{ type: 'text', text: JSON.stringify(value) }] }] }));

test('each assistance level uses Gemini with distinct instructions and literal bounded lesson data', async () => {
  const prompts = [];
  for (const level of [1, 2, 3]) {
    const logs = [];
    const body = { level, source: 'print 5', stdin: '1\n\n', compilerOutput: 'board.c:1: error' };
    const result = await assistPseudocode(body, { env, logger: (entry) => logs.push(entry), fetchImpl: async (url, options) => {
      assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/interactions');
      assert.equal(options.headers['x-goog-api-key'], env.GEMINI_API_KEY);
      const sent = JSON.parse(options.body);
      assert.equal(sent.store, false);
      assert.deepEqual(JSON.parse(sent.input[0].text), { source: body.source, stdin: body.stdin, compilerOutput: body.compilerOutput });
      assert.equal(sent.response_format.schema.properties.source.type, 'string');
      prompts.push(sent.system_instruction);
      return reply(proposal);
    } });
    assert.equal(result.source, proposal.source);
    assert.equal(result.level, level);
    assert.equal(result.provider, 'gemini');
    assert.deepEqual(logs[0].usage, { total_tokens: 10 });
    assert.ok(!JSON.stringify(logs).includes(body.source));
    assert.ok(!JSON.stringify(logs).includes(env.GEMINI_API_KEY));
  }
  assert.match(prompts[0], /advice only/);
  assert.match(prompts[1], /missing main/);
  assert.match(prompts[2], /plain-language steps/);
});

test('rejects invalid requests before provider calls and missing credentials', async () => {
  for (const body of [null, {}, { level: 0, source: 'x' }, { level: 1, source: '' }, { level: 1, source: 'x'.repeat(32769) },
    { level: 2, source: 'x\0' }, { level: 3, source: 'x', stdin: 1 }, { level: 1, source: 'x', compilerOutput: 'x'.repeat(16385) }]) {
    assert.throws(() => validatePseudocode(body));
  }
  await assert.rejects(assistPseudocode({ level: 2, source: 'print 5' }, { env: {} }), (error) => error.status === 503);
});

test('named teaching libraries include their actual APIs and require angle-bracket includes', async () => {
  let instruction;
  await assistPseudocode({ level: 3, source: 'Use queue.h to add 4 and 7, then print both.' }, {
    env, logger: () => {}, fetchImpl: async (_url, options) => {
      instruction = JSON.parse(options.body).system_instruction;
      return reply(proposal);
    },
  });
  assert.match(instruction, /queue_init\(Queue \*queue\)/);
  assert.match(instruction, /#include <header>/);
  assert.ok(!instruction.includes('BOARD_LIST_H'));
});

test('rejects malformed, fenced, oversized and incomplete proposals before execution', async () => {
  for (const value of [null, {}, { ...proposal, source: '```c\nint main(){}\n```' }, { ...proposal, source: 'x'.repeat(32769) },
    { ...proposal, issues: [{ line: 2, message: 'unknown line' }] }, { ...proposal, issues: [{ line: -1, message: 'x' }] }]) {
    assert.throws(() => validatePseudocodeResult(value, 'one line'), (error) => error.status === 502);
  }
  await assert.rejects(assistPseudocode({ level: 3, source: 'print 5' }, { env, logger: () => {}, fetchImpl: async () => reply(null) }), /proposal/);
  await assert.rejects(assistPseudocode({ level: 3, source: 'print 5' }, { env, logger: () => {}, fetchImpl: async () =>
    new Response(JSON.stringify({ status: 'in_progress' })) }), /did not finish/);
  await assert.rejects(assistPseudocode({ level: 3, source: 'print 5' }, { env, logger: () => {}, fetchImpl: async () =>
    new Response('private malformed provider text') }), (error) => error.status === 502 && error.diagnostic.reason === 'invalid_response');
});

test('reports quota evidence and timeouts without leaking private provider messages', async () => {
  const logs = [];
  await assert.rejects(assistPseudocode({ level: 2, source: 'print 5' }, { env, logger: (entry) => logs.push(entry), fetchImpl: async () =>
    new Response(JSON.stringify({ error: { message: `token quota private ${env.GEMINI_API_KEY}` } }), { status: 429 }) }), (error) => {
    assert.equal(error.status, 429);
    assert.equal(error.diagnostic.quotaStatus, 'token_limit_reached');
    assert.ok(!error.message.includes(env.GEMINI_API_KEY));
    return true;
  });
  await assert.rejects(assistPseudocode({ level: 3, source: 'print 5' }, { env, logger: () => {}, fetchImpl: async () => {
    throw new DOMException('private timeout', 'TimeoutError');
  } }), (error) => error.status === 504 && error.diagnostic.quotaStatus === 'unknown');
  assert.ok(!JSON.stringify(logs).includes(env.GEMINI_API_KEY));
});

test('Python assistance targets Python at each level and never reads C headers', async () => {
  for (const level of [1, 2, 3]) {
    let prompt;
    const result = await assistPseudocode({ level, source: 'print five', language: 'python' }, {
      env, logger: () => {}, readHeader: async () => { throw new Error('No C headers for Python'); },
      fetchImpl: async (_url, options) => { prompt = JSON.parse(options.body).system_instruction;
        return reply({ source: 'print(5)\n', explanation: 'Completed Python.', issues: [] }); },
    });
    assert.match(prompt, /demonstrating Python 3/);
    assert.match(prompt, /standard library only/);
    assert.ok(!prompt.includes('source must be complete C'));
    assert.ok(!prompt.includes('Use only these standard headers'));
    assert.equal(result.language, 'python');
    assert.equal(result.source, 'print(5)\n');
  }
  assert.throws(() => validatePseudocode({ source: 'x', level: 1, language: 'javascript' }), /C\+\+ or Python/);
});

test('template fixes receive assembled code and compiler evidence with C++ scope instructions', async () => {
  const source = '#include <stdio.h>\nint main(){\n template<class T> T twice(T x){return x+x;}\n}';
  const compilerOutput = 'board.cpp:3: error: a template declaration cannot appear at block scope';
  let request;
  await assistPseudocode({ source, compilerOutput, stdin: '2\n', level: 1, templateMode: true }, {
    env, logger: () => {}, fetchImpl: async (_url, options) => { request = JSON.parse(options.body); return reply(proposal); },
  });
  assert.match(request.system_instruction, /function templates, class templates, free-function definitions/);
  assert.match(request.system_instruction, /Classes and structs may be legal local declarations/);
  assert.match(request.system_instruction, /exactly one main/);
  assert.match(request.system_instruction, /Preserve existing headers, globals and helper functions/);
  assert.deepEqual(JSON.parse(request.input[0].text), { source, stdin: '2\n', compilerOutput });
  for (const invalid of [{ templateMode: 'yes' }, { templateMode: true, language: 'python' }, { templateMode: true, level: 3 }]) {
    assert.throws(() => validatePseudocode({ source, level: 1, ...invalid }), /Template fixes/);
  }
});

test('snippet structure requests send only the snippet and template, with organize-only instructions', async () => {
  let sent;
  const body = { level: 2, structure: true, source: 'Stack s;\nstack_init(&s);', stdin: '', templateContext: '#include <stdio.h>\n#include <stack.h>' };
  const result = await assistPseudocode(body, { env, logger: () => {}, readHeader: async (file) => `/* ${file} */`, fetchImpl: async (url, options) => {
    sent = JSON.parse(options.body);
    return reply({ source: 'int main() {\nStack s;\nstack_init(&s);\nreturn 0;\n}', explanation: 'Added main.', issues: [] });
  } });
  assert.deepEqual(JSON.parse(sent.input[0].text), { source: body.source, template: body.templateContext });
  assert.match(sent.system_instruction, /not a debugger or syntax fixer/);
  assert.match(sent.system_instruction, /Do not correct syntax errors/);
  assert.match(sent.system_instruction, /do not add main\(\)/);
  assert.match(sent.system_instruction, /stack\.h \*\//);
  assert.equal(result.structure, true);
  assert.equal(result.level, 2);
});

test('structure requests are limited to C++ snippet mode', () => {
  assert.doesNotThrow(() => validatePseudocode({ level: 2, structure: true, source: 'x();' }));
  for (const body of [{ level: 1, structure: true, source: 'x' }, { level: 3, structure: true, source: 'x' },
    { level: 2, structure: true, source: 'x', language: 'python' }, { level: 2, structure: 'yes', source: 'x' },
    { level: 2, structure: true, source: 'x', templateContext: 5 }, { level: 2, structure: true, source: 'x', templateContext: 'x'.repeat(16385) }]) {
    assert.throws(() => validatePseudocode(body));
  }
});
