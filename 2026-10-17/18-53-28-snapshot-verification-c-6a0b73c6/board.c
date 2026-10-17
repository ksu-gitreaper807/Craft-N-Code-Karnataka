#include <stdio.h>
#include <queue.h>

int main(void) {
    Queue q;
    queue_init(&q);
    queue_free(&q);
    puts("Snapshot verification");
    return 0;
}
