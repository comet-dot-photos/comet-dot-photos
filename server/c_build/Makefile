# ===== config ===============================================================
SRC           := checkvis2.c
NAME          := checkvis2
CFLAGS_COMMON := -O3 -Wall -Wextra
PIC           := -fPIC

# Detect host arch for single-arch targets
UNAME_S := $(shell uname -s)
UNAME_M := $(shell uname -m)

# Use -mpopcnt only on x86_64; it's x86-specific and errors on ARM
ifeq ($(UNAME_M),x86_64)
  POPCNT := -mpopcnt
else
  POPCNT :=
endif

# Default target
.PHONY: all
all: linux-popcnt

# ===== Linux (GCC/Clang) ====================================================
linux-popcnt: $(SRC)
	$(CC) $(SRC) $(CFLAGS_COMMON) $(POPCNT) $(PIC) -shared -o $(NAME).so

# ===== macOS (Clang) ========================================================
# Build per-arch and lipo into a universal .dylib. Only the x86_64 slice gets -mpopcnt.
macos-x64: $(SRC)
	clang $(SRC) $(CFLAGS_COMMON) -arch x86_64 -fPIC -dynamiclib -mpopcnt -o $(NAME).darwin_x64.dylib

macos-arm64: $(SRC)
	clang $(SRC) $(CFLAGS_COMMON) -arch arm64  -fPIC -dynamiclib              -o $(NAME).darwin_arm64.dylib

macos-universal: macos-arm64 macos-x64
	lipo -create $(NAME).darwin_arm64.dylib $(NAME).darwin_x64.dylib -output $(NAME).dylib

# Single-arch build for the current Mac (adds -mpopcnt only if host is x86_64)
macos-popcnt: $(SRC)
	clang $(SRC) $(CFLAGS_COMMON) $(POPCNT) -fPIC -dynamiclib -o $(NAME).dylib

# ===== Windows (MinGW-w64 / MSYS2) ==========================================
# Use inside MSYS2 MinGW64 shell, or pass CC=x86_64-w64-mingw32-gcc when cross-compiling.
# We add -mpopcnt (x86_64 only). No other ISA flags.
win-popcnt: $(SRC)
	$(CC) $(SRC) $(CFLAGS_COMMON) -mpopcnt -shared -o $(NAME).dll

# ===== convenience & clean ==================================================
.PHONY: macos-all clean
macos-all: macos-x64 macos-arm64 macos-universal

clean:
	rm -f $(NAME).so $(NAME).dll $(NAME).dylib \
	      $(NAME).darwin_x64.dylib $(NAME).darwin_arm64.dylib
