// DisplayBridge adapter. Uses the vendored MIT-licensed m1ddc transport.
@import Foundation;
@import IOKit;
@import CoreGraphics;
#include <stdlib.h>
#include <string.h>
#include "ioregistry.h"
#include "i2c.h"

static BOOL readInput(DDCTransport transport, UInt16 *value) {
    if (!transport.service) return NO;
    DDCPacket packet=createDDCPacket(INPUT);
    // The pinned transport XORs data[3] into the request checksum. Seed it
    // with the host address so Get VCP includes both 0x6e and 0x51.
    packet.data[3]=packet.inputAddr;
    prepareDDCRead(packet.data);
    if(performDDCWriteAtChipAddress(transport.service,transport.chipAddress,&packet)!=kIOReturnSuccess) return NO;
    if(performDDCReadAtChipAddress(transport.service,transport.chipAddress,&packet)!=kIOReturnSuccess) return NO;
    // Reject empty, unsupported, wrong-code and corrupt replies, rather than inventing input 0.
    UInt8 *b=packet.data;
    if(b[0]!=0x6e || (b[1]&0x7f)!=8 || b[2]!=0x02 || b[3]!=0 || b[4]!=INPUT) return NO;
    UInt8 checksum=0x50;
    for(int i=0;i<11;i++) checksum^=b[i];
    if(checksum!=0) return NO;
    *value=((UInt16)b[8]<<8)|b[9];
    return *value>0 && *value<=255;
}
int main(int argc,const char *argv[]) {
    @autoreleasepool {
        BOOL listing=argc==2 && strcmp(argv[1],"displaybridge-list")==0;
        BOOL setting=argc==6 && strcmp(argv[1],"display")==0 && strcmp(argv[3],"set")==0 && strcmp(argv[4],"input")==0;
        if(!listing&&!setting){fprintf(stderr,"Invalid arguments\n");return 2;}
        long input=0;
        if(setting){char *end=NULL;input=strtol(argv[5],&end,10);if(!end||*end||input<1||input>255)return 2;}
        DisplayInfos infos[MAX_DISPLAYS]={0};
        CGDisplayCount count=getOnlineDisplayInfos(infos);
        NSMutableArray *rows=[NSMutableArray array];
        BOOL found=NO;
        for(CGDisplayCount i=0;i<count;i++) {
            DisplayInfos *d=&infos[i];
            if(CGDisplayIsBuiltin(d->id)||!d->uuid)continue;
            if(setting && strcmp([d->uuid UTF8String],argv[2])!=0)continue;
            DDCTransport transport=getDisplayDDCTransport(d);
            if(setting){
                found=YES;
                if(!transport.service){fprintf(stderr,"Display DDC is unavailable through this connection\n");return 1;}
                DDCPacket packet=createDDCPacket(INPUT);prepareDDCWrite(&packet,(UInt16)input);
                IOReturn result=performDDCWriteAtChipAddress(transport.service,transport.chipAddress,&packet);
                CFRelease(transport.service);
                if(result!=kIOReturnSuccess){fprintf(stderr,"DDC write failed: %d\n",result);return 1;}
                puts("{\"ok\":true}");return 0;
            }
            UInt16 value=0;BOOL readable=readInput(transport,&value);
            [rows addObject:@{@"id":d->uuid,@"displayId":@(d->id),@"name":d->productName?:@"External display",@"serial":d->alphNumSerial?:@"",@"primary":@(d->id==CGMainDisplayID()),@"input":readable?(id)@(value):(id)[NSNull null],@"readable":@(readable),@"error":readable?(id)[NSNull null]:(id)@"DDC input read unavailable",@"connector":d->ioLocation?:@""}];
            if(transport.service)CFRelease(transport.service);
        }
        if(setting&&!found){fprintf(stderr,"Display is not currently enumerated\n");return 1;}
        NSError *error=nil;NSData *data=[NSJSONSerialization dataWithJSONObject:rows options:0 error:&error];
        if(!data){fprintf(stderr,"JSON encoding failed\n");return 1;}
        fwrite(data.bytes,1,data.length,stdout);fputc('\n',stdout);return 0;
    }
}
