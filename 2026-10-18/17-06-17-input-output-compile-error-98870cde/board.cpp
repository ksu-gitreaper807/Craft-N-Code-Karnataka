#include <stdio.h>

int main(void) {
    int a, b
    if (scanf("%d %d", &a, &b) != 2) {
        puts("Please supply two integers.");
        return 1;
    }
    printf("%d + %d = %d\n", a, b, a + b);
    return 0;
}