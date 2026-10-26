// MX Keys / MX Master 3S allowlist only. Inspect is read-only; switching requires an explicit 1..3 channel.
#import <Foundation/Foundation.h>
#import <IOKit/hid/IOHIDManager.h>
#import <IOKit/hidsystem/IOHIDLib.h>

typedef struct { uint8_t feature; uint8_t function; BOOL received; BOOL failed; uint8_t result[16]; } Reply;
static void report(void *context, IOReturn status, void *sender, IOHIDReportType type,
                   uint32_t reportId, uint8_t *bytes, CFIndex length) {
  Reply *reply=context;
  // Ignore keystrokes and all other unsolicited device reports entirely.
  if(status!=kIOReturnSuccess||length<7||bytes[0]!=0x11||bytes[1]!=0xff)return;
  if(bytes[2]==0xff&&bytes[3]==reply->feature&&bytes[4]==reply->function){reply->failed=YES;return;}
  if(bytes[2]!=reply->feature||bytes[3]!=reply->function)return;
  memset(reply->result,0,sizeof(reply->result));
  memcpy(reply->result,bytes+4,MIN((size_t)(length-4),sizeof(reply->result)));
  reply->received=YES;
}
static BOOL query(IOHIDDeviceRef device,Reply *reply,uint8_t feature,uint8_t function,uint8_t p0,uint8_t p1) {
  reply->feature=feature;reply->function=(function<<4)|0x0a;reply->received=NO;reply->failed=NO;
  uint8_t packet[20]={0x11,0xff,feature,reply->function,p0,p1};
  IOReturn status=IOHIDDeviceSetReport(device,kIOHIDReportTypeOutput,0x11,packet,sizeof(packet));
  if(status!=kIOReturnSuccess)return NO;
  CFAbsoluteTime end=CFAbsoluteTimeGetCurrent()+2;
  while(!reply->received&&!reply->failed&&CFAbsoluteTimeGetCurrent()<end)
    CFRunLoopRunInMode(kCFRunLoopDefaultMode,0.05,true);
  return reply->received;
}
static NSDictionary *probe(BOOL requestAccess,int target,BOOL names,BOOL mouse) {
  IOHIDManagerRef manager=IOHIDManagerCreate(kCFAllocatorDefault,kIOHIDOptionsTypeNone);
  IOHIDManagerSetDeviceMatching(manager,(__bridge CFDictionaryRef)@{@kIOHIDVendorIDKey:@0x046d,@kIOHIDProductIDKey:@(mouse?0xb034:0xb35b)});
  NSSet *devices=CFBridgingRelease(IOHIDManagerCopyDevices(manager));
  NSMutableDictionary *result=[@{@"status":@"not-connected",@"device":mouse?@"MX Master 3S":@"MX Keys"} mutableCopy];
  for(id object in devices) {
    IOHIDDeviceRef device=(__bridge IOHIDDeviceRef)object;
    NSArray *pairs=(__bridge NSArray *)IOHIDDeviceGetProperty(device,CFSTR(kIOHIDDeviceUsagePairsKey));
    BOOL vendor=NO;
    for(NSDictionary *pair in pairs)if([pair[@"DeviceUsagePage"] intValue]==0xff43&&[pair[@"DeviceUsage"] intValue]==0x0202)vendor=YES;
    if(!vendor)continue;
    IOHIDAccessType access=IOHIDCheckAccess(kIOHIDRequestTypeListenEvent);
    if(access!=kIOHIDAccessTypeGranted&&requestAccess){IOHIDRequestAccess(kIOHIDRequestTypeListenEvent);access=IOHIDCheckAccess(kIOHIDRequestTypeListenEvent);}
    if(access!=kIOHIDAccessTypeGranted){result[@"status"]=@"permission-required";break;}
    IOReturn opened=IOHIDDeviceOpen(device,kIOHIDOptionsTypeNone);
    if(opened!=kIOReturnSuccess){result[@"status"]=(opened==kIOReturnNotPermitted||opened==kIOReturnNotPrivileged)?@"permission-required":@"open-failed";result[@"code"]=[NSString stringWithFormat:@"0x%08x",opened];break;}
    uint8_t input[512]={0};Reply reply={0};
    IOHIDDeviceRegisterInputReportCallback(device,input,sizeof(input),report,&reply);
    IOHIDDeviceScheduleWithRunLoop(device,CFRunLoopGetCurrent(),kCFRunLoopDefaultMode);
    result[@"status"]=@"no-response";
    if(query(device,&reply,0,0,0x18,0x14)) {
      uint8_t feature=reply.result[0];
      if(!feature)result[@"status"]=@"unsupported";
      else if(query(device,&reply,feature,0,0,0)){
        uint8_t count=reply.result[0],current=reply.result[1];
        if(count>=1&&count<=3&&current<count){
          result[@"status"]=@"ready";result[@"channels"]=@(count);result[@"currentChannel"]=@(current+1);
          if(target>count)result[@"status"]=@"invalid-channel";
          else if(target>0&&target!=current+1){
            uint8_t packet[20]={0x11,0xff,feature,0x1a,(uint8_t)(target-1)};
            IOReturn sent=IOHIDDeviceSetReport(device,kIOHIDReportTypeOutput,0x11,packet,sizeof(packet));
            result[@"status"]=sent==kIOReturnSuccess?@"sent":@"write-failed";result[@"targetChannel"]=@(target);
          }else if(names&&query(device,&reply,0,0,0x18,0x15)&&reply.result[0]){
            uint8_t info=reply.result[0];NSMutableArray *hosts=[NSMutableArray array];
            if(query(device,&reply,info,0,0,0)&&(reply.result[0]&1)){
              for(uint8_t host=0;host<count;host++)if(query(device,&reply,info,1,host,0)){
                BOOL paired=reply.result[1]!=0;uint8_t length=reply.result[4];NSMutableData *name=[NSMutableData data];
                if(length<=100)for(uint8_t offset=0;offset<length;offset+=14){if(!query(device,&reply,info,3,host,offset))break;[name appendBytes:reply.result+2 length:MIN(14,length-offset)];}
                NSString *text=[[NSString alloc]initWithData:name encoding:NSUTF8StringEncoding]?:@"";
                [hosts addObject:@{@"channel":@(host+1),@"paired":@(paired),@"name":text}];
              }
            }
            result[@"hosts"]=hosts;
          }
        }
      }
    }
    IOHIDDeviceUnscheduleFromRunLoop(device,CFRunLoopGetCurrent(),kCFRunLoopDefaultMode);
    IOHIDDeviceClose(device,kIOHIDOptionsTypeNone);
    break;
  }
  CFRelease(manager);return result;
}
int main(int argc,const char *argv[]) { @autoreleasepool {
  BOOL mouse=argc>1&&strcmp(argv[1],"mouse")==0;if(mouse){argc--;argv++;}
  BOOL request=argc==2&&strcmp(argv[1],"request-access")==0,names=argc==2&&strcmp(argv[1],"inspect-hosts")==0;
  int target=0;if(argc==3&&strcmp(argv[1],"switch")==0&&strlen(argv[2])==1&&argv[2][0]>='1'&&argv[2][0]<='3')target=argv[2][0]-'0';
  if(!target&&(argc!=2||(!request&&!names&&strcmp(argv[1],"inspect")!=0))){fputs("Unknown command\n",stderr);return 1;}
  NSData *data=[NSJSONSerialization dataWithJSONObject:probe(request,target,names,mouse) options:0 error:nil];
  puts([[NSString alloc]initWithData:data encoding:NSUTF8StringEncoding].UTF8String);
}return 0;}
