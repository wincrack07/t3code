#!/bin/sh
# Builds the universal (arm64 + x86_64) Apple speech helper into native/apple-speech/build.
set -eu
cd "$(dirname "$0")"
mkdir -p build
for arch in arm64 x86_64; do
  xcrun swiftc -O -target "$arch-apple-macos13" main.swift -o "build/t3-apple-speech-$arch"
done
lipo -create build/t3-apple-speech-arm64 build/t3-apple-speech-x86_64 -output build/t3-apple-speech
rm build/t3-apple-speech-arm64 build/t3-apple-speech-x86_64
