// Run the real adapter/parser with only the external I2C boundary replaced.
#define main displaybridge_app_main
#include "../native/macos/DisplayDdc.m"
#undef main
#include <stdio.h>

static UInt8 replyBytes[12];
static BOOL rejectRead = NO;

IOReturn IOAVServiceWriteI2C(IOAVServiceRef service, uint32_t chip,
                           uint32_t address, void *buffer, uint32_t length) {
    const UInt8 expected[] = {0x82, 0x01, 0x60, 0xdc};
    // Get VCP 0x60: checksum includes destination 0x6e and host 0x51.
    // Any Set VCP packet fails this test without reaching real hardware.
    if (chip != 0x37 || address != 0x51 || length != sizeof(expected) ||
        memcmp(buffer, expected, sizeof(expected))) return kIOReturnBadArgument;
    return kIOReturnSuccess;
}

IOReturn IOAVServiceReadI2C(IOAVServiceRef service, uint32_t chip,
                          uint32_t offset, void *buffer, uint32_t length) {
    if (rejectRead) return kIOReturnError;
    if (length != sizeof(replyBytes)) return kIOReturnBadArgument;
    memcpy(buffer, replyBytes, length);
    return kIOReturnSuccess;
}

static int check(const char *name, const UInt8 *bytes, BOOL expected, UInt16 input) {
    memcpy(replyBytes, bytes, sizeof(replyBytes));
    DDCTransport t = {.service = (CFTypeRef)1, .chipAddress = 0x37};
    UInt16 value = 0;
    BOOL readable = readInput(t, &value);
    if (readable != expected || (readable && value != input)) {
        fprintf(stderr, "%s: readable=%d input=%u, expected=%d/%u\n",
                name, readable, value, expected, input);
        return 1;
    }
    return 0;
}

int main(void) {
    @autoreleasepool {
        const UInt8 aoc[] = {0x6e,0x88,0x02,0x00,0x60,0x00,0x20,0x0e,0x00,0x10,0xea,0x0b};
        const UInt8 asus[] = {0x6e,0x88,0x02,0x00,0x60,0x00,0x00,0x03,0x00,0x0f,0xd8,0x6e};
        const UInt8 empty[12] = {0};
        const UInt8 nullReply[] = {0x6e,0x80,0xbe,0x6e,0x80,0xbe,0x6e,0x80,0xbe,0x6e,0x80,0xbe};
        UInt8 corrupt[12]; memcpy(corrupt, aoc, sizeof(corrupt)); corrupt[10] ^= 1;
        int failures = check("AOC real reply", aoc, YES, 16);
        failures += check("ASUS real reply", asus, YES, 15);
        failures += check("empty reply", empty, NO, 0);
        failures += check("null reply", nullReply, NO, 0);
        failures += check("corrupt checksum", corrupt, NO, 0);
        rejectRead = YES;
        failures += check("I2C read failure", aoc, NO, 0);
        UInt16 value = 0;
        failures += readInput((DDCTransport){0}, &value) ? 1 : 0;
        printf("native adapter cases: 7, failures: %d\n", failures);
        return failures ? 1 : 0;
    }
}
