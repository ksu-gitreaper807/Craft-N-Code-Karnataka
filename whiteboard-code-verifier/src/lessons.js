export const lessons = [
  {
    id: 'sum',
    title: 'Input & output',
    description: 'Two numbers, one small program. Try removing a semicolon to see a compiler diagnostic on the board.',
    stdin: '3 5\n',
    source: '#include <stdio.h>\n\nint main(void) {\n    int a, b;\n    if (scanf("%d %d", &a, &b) != 2) {\n        puts("Please supply two integers.");\n        return 1;\n    }\n    printf("%d + %d = %d\\n", a, b, a + b);\n    return 0;\n}',
  },
  {
    id: 'memory',
    title: 'A memory mistake',
    description: 'What happens after free()? Run this lesson, then move free(values) below the printf and try again.',
    stdin: '',
    source: '#include <stdio.h>\n#include <stdlib.h>\n\nint main(void) {\n    setvbuf(stdout, NULL, _IONBF, 0);\n    int *values = malloc(3 * sizeof *values);\n    if (!values) return 1;\n    values[0] = 42;\n    printf("Pointer on stack: %p\\n", (void *)&values);\n    printf("Buffer address: %p\\n", (void *)values);\n    free(values);\n    printf("First value: %d\\n", values[0]);\n    return 0;\n}',
  },
  {
    id: 'stack',
    title: 'Under the abstraction',
    description: 'An empty stack has a contract. Add stack_push(&s, 42) before stack_pop to satisfy it.',
    stdin: '',
    source: '#include <stdio.h>\n#include <stack.h>\n\nint main(void) {\n    Stack s;\n    stack_init(&s);\n    int value = stack_pop(&s);\n    printf("Popped: %d\\n", value);\n    stack_free(&s);\n    return 0;\n}',
  },
];
