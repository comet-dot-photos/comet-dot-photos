#include <stdio.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include "popcount.h"



typedef struct {
    uint64_t *vbuff;
    int nRows;
    int nBytesPerRow;
    int nLongsPerRow;
} VisTable;

#define MAX_TABLES 16
static VisTable tables[MAX_TABLES]; // zero-initialized

// Like old load_vbuff, but stores result in tables.
// Returns 0 on success, nonzero on failure
int load_vbuff2(int table_id, const char *visFile, int rows, int bytesPerRow) {
    if (table_id < 0 || table_id >= MAX_TABLES) return 2;
    VisTable *t = &tables[table_id];

    // free previous if any (for future extensibility)
    if (t->vbuff) { free(t->vbuff); memset(t, 0, sizeof(*t)); }

    t->nRows = rows;
    t->nBytesPerRow = bytesPerRow;
    t->nLongsPerRow = bytesPerRow / 8;

    size_t buffSize = (size_t)rows * (size_t)bytesPerRow;
    t->vbuff = (uint64_t*)malloc(buffSize);
    if (!t->vbuff) return 3;

    FILE *fp = fopen(visFile, "rb");
    if (!fp) return 1;
    size_t ret = fread(t->vbuff, 1, buffSize, fp);
    fclose(fp);
    return (ret == buffSize) ? 0 : 4;
}

int check_nRows2(int table_id) {
    if (table_id < 0 || table_id >= MAX_TABLES) return -1;
    return tables[table_id].nRows;
}

// Same logic as check_vis, but table-local:
void check_vis2(int table_id, int mustMatch, uint8_t *filterArray, uint64_t *this_v) {
    VisTable *t = &tables[table_id];
    int nRows = t->nRows, nLongsPerRow = t->nLongsPerRow;

    uint8_t *filterByte = filterArray;
    int maskPos = 0;
    for (int i = 0; i < nRows; i++) {
        if (*filterByte & (0x1 << maskPos)) {
            int nMatched = 0;
            uint64_t *src = this_v;
            uint64_t *dst = t->vbuff + (size_t)i * (size_t)nLongsPerRow;
            for (int j = 0; j < nLongsPerRow; j++) {
                uint64_t andVal = *src & *dst;
                if (andVal) {
                    // fast hardware popcount
                    nMatched += popcount64_u64(andVal);
                    if (nMatched >= mustMatch) break;
                }
                src++; dst++;
            }
            if (nMatched < mustMatch) *filterByte &= ~(0x1 << maskPos);
        }
        if (maskPos < 7) maskPos++; else { filterByte++; maskPos = 0; }
    }
}