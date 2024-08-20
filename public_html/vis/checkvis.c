#include <stdio.h>
#include <stdint.h>
#include <stdlib.h>

#define FM_BBOX 2
#define FM_VIS 2
#define TRUE 1
#define FALSE 0

static uint64_t *vbuff = NULL;
static int nRows, nBytesPerRow, nLongsPerRow;

int load_vbuff(int rows, int bytesPerRow) {
    nRows = rows;
    nBytesPerRow = bytesPerRow;
    nLongsPerRow = nBytesPerRow / 8;
    int buffSize = nRows*nBytesPerRow;
    vbuff = malloc(buffSize);
    FILE *fp = fopen("./cometVis.bin", "r");
    int ret = fread(vbuff, 1, buffSize, fp);
    if (ret != buffSize) return -1;
    else return 0;
}

int check_nRows() {
    return nRows;
}

/*
void check_vis(short *filterArray, uint64_t *this_v) {   // filterArray is nRows long of 16 bit ints
    short *filter = filterArray;
    for (int i = 0; i < nRows; i++) {
        if (!(*filter & FM_BBOX)) {  // line passed the BBOX test, need to do more comp test here
            int matched = FALSE;
            uint64_t *src = this_v;
            uint64_t *dst = vbuff+(i*nLongsPerRow);
            for (int j = 0; j < nLongsPerRow; j++) {
                if (*src & *dst) {
                    matched = TRUE;
                    break;
                }
                src++;
                dst++;
            }
            if (!matched) *filter &= FM_BBOX;
        }      
    }
}
*/

void print_bit(int vnum, uint64_t *src, uint64_t *dest, char *str) {
    uint64_t *src_long = src+(vnum/64);
    uint64_t *dst_long = dest+(vnum/64);
    int mask = 1 << (vnum % 64);
    printf("%s: src bit is %s, dst bit is %s\n", str, (*src_long & mask) ? "set" : "unset", (*dst_long & mask) ? "set" : "unset");
    fflush(stdout);
}

void print_viscount(char *buff, char *str, int src) {
    int bitcount = 0;
    for (int i = 0; i < nBytesPerRow; i++) {
        for (int j = 0; j < 8; j++) {
            if (buff[i] & (1 << j)) {
                bitcount++;
                if (src) printf("In source, got a set vertex at position %d\n", i*8 + j);
            }
        }
    }
    printf("%s: in print_viscount, bitcount is %d\n", str, bitcount);
    fflush(stdout);
}

void check_vis(int mustMatch, uint8_t *filterArray, uint64_t *this_v) {   // filterArray is nRows long of 16 bit ints
    // fprintf(stderr, "mustMatch = %d\n", mustMatch);
    int debug_line = 2161;
    uint8_t *filterByte = filterArray;
    int maskPos = 0;
    for (int i = 0; i < nRows; i++) {
        if (*filterByte & (0x1 << maskPos)) {  // if this is set, we need to do the full test...
            int nMatched = 0; // per line, >= mustMatched for img to pass
            int matched = FALSE;
            uint64_t *src = this_v;
            uint64_t *dst = vbuff+(i*nLongsPerRow);
            for (int j = 0; j < nLongsPerRow; j++) {
                uint64_t andVal = *src & *dst;
                if (andVal) {
                    for (int k = 0; k < 64; k++) {
                        if (andVal & (((uint64_t)1) << k))
                            nMatched++;
                    }
                    if (nMatched >= mustMatch) break;   // don't need to look further
                    // if (i == debug_line) {
                    //     print_bit(74109, this_v, vbuff+(i*nLongsPerRow), "Byte 74109 of src");
                    //     print_bit(74136, this_v, vbuff+(i*nLongsPerRow), "Byte 74136 of src");
                    //     print_bit(74157, this_v, vbuff+(i*nLongsPerRow), "Byte 74157 of src");
                    //     print_bit(74349, this_v, vbuff+(i*nLongsPerRow), "Byte 74349 of src");
                    //     printf("Bytes matched at %d offset\n", j);
                    //     printf("Bytes were %lx and %lx\n", *src, *dst);
                    //     fflush(stdout);
                    //     print_viscount((char *)this_v, "Source", 1);
                    //     print_viscount((char *)(vbuff+(i*nLongsPerRow)), "Dest", 0);
                    // }
                }
                src++;
                dst++;
            }
            // if (i == debug_line) {
            //     printf("For img #%d, mustMatch = %d, nMatched = %d, img passed = %d\n", debug_line, mustMatch, nMatched, nMatched >= mustMatch);
            // }
            if (nMatched < mustMatch) *filterByte &= ~(0x1 << maskPos);  // clear the bit - failed
            // if (i == debug_line) {
            //     printf("In checkvis, line %d, matched = %d\n", debug_line, matched);
            //     fflush(stdout);
            // }
        } 
        if (maskPos < 7) maskPos++;
        else {
            filterByte++;
            maskPos = 0;
        }  
    }
}

int count_vis(uint64_t *this_v) {   
    int matches = 0;
    for (int i = 0; i < nRows; i++) {
        // if (!(*filter & FM_BBOX)) {  // line passed the BBOX test, need to do more comp test here
            int matched = FALSE;
            uint64_t *src = this_v;
            uint64_t *dst = vbuff+(i*nLongsPerRow);
            for (int j = 0; j < nLongsPerRow; j++) {
                if (*src & *dst) {
                    matched = TRUE;
                    break;
                }
                src++;
                dst++;
            }
            if (matched) matches++;;
        // }      
    }
    return matches;
}

int count_filterarray(uint8_t *filterArray) {
    uint8_t *current_byte = filterArray;
    int shift = 0;
    int count = 0;
    for (int i = 0; i < nRows; i++) {
        if (*current_byte & (0x1 << shift))
            count++;
        if (shift >= 7) {
            current_byte++;
            shift = 0;
        } else
            shift++;
    }
    return count;
}
