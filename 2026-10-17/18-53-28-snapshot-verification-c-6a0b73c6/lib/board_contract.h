#ifndef BOARD_CONTRACT_H
#define BOARD_CONTRACT_H

#include <stdio.h>
#include <stdlib.h>

/* Internal helper: public operation macros pass the teacher's board line. */
static inline void board_contract_fail(const char *library, const char *message, int line) {
    fprintf(stderr, "[%s] CONTRACT: %s, board line %d\n", library, message, line);
    exit(2);
}

#endif
