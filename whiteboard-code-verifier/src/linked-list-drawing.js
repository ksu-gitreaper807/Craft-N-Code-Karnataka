import { composeSource } from './template.js';

// Interpret only an entire, unbranched integer chain, never C++ expressions/code.
export function linkedListDrawing(source) {
  if (typeof source !== 'string' || source.length > 8192 ||
      !/^\s*[+-]?\d+\s*(?:(?:->|→)\s*[+-]?\d+\s*)+$/.test(source)) return null;
  const values = source.trim().split(/\s*(?:->|→)\s*/).map(Number);
  if (values.some(value => !Number.isInteger(value) || value < -2147483648 || value > 2147483647)) return null;
  return values.join('->');
}

export function linkedListProgram(drawing) {
  return `#include <stdio.h>
#include <linked_list.h>

int main() {
    LinkedList list;
    list_init(&list);
    if (!list_from_arrows(&list, ${JSON.stringify(drawing)})) {
        fputs("Invalid linked-list drawing.\\n", stderr);
        list_free(&list);
        return 1;
    }
    for (const ListNode *node = list.head; node; node = node->next) {
        printf("%d%s", node->value, node->next ? "->" : "\\n");
    }
    list_free(&list);
    return 0;
}`;
}

export function composeBoardSource(source, template, wrap, language = 'c', algorithm = false) {
  const drawing = language === 'c' && !algorithm ? linkedListDrawing(source) : null;
  return drawing === null ? composeSource(source, template, wrap) :
    { source: linkedListProgram(drawing), wrapped: false, skipped: false, drawing };
}
