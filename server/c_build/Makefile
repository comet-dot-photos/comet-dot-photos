# Define the compiler and flags
CC = gcc
CFLAGS = -O3 -fPIC
LDFLAGS = -shared
MACOS_LDFLAGS = -dynamiclib
MACOS_CFLAGS = -O3 -fPIC -arch x86_64

# Define the target and source files
TARGET = checkvis.so
SRCS = checkvis.c

# Default rule to build the target
all: $(TARGET)

# Rule to build the shared library
$(TARGET): $(SRCS)
	$(CC) $(CFLAGS) $(LDFLAGS) -o $@ $^

macOS-x64: $(SRCS)
	gcc checkvis.c -O3 -fPIC -arch x86_64 -dynamiclib -o checkvis.darwin_x64.dylib 

macOS-arm64: $(SRCS)
	gcc checkvis.c -O3 -fPIC -arch arm64 -dynamiclib -o checkvis.darwin_arm64.dylib 

macOS-universal: $(SRCS)
	lipo -create checkvis.darwin_arm64.dylib checkvis.darwin_x64.dylib -output checkvis.darwin_univ.dylib

# Clean rule to remove the built files
clean:
	rm -f $(TARGET)

