#include <stdio.h>
#include <stdlib.h>

int main(void) {
    int *x;
    x = (int *)malloc(5 * sizeof(int));
    if (x == NULL) {
        return 1;
    }
    printf("%d\n", x[0]);
    free(x);
    return 0;
}
