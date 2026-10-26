using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Web.Script.Serialization;
using Microsoft.Win32.SafeHandles;

// MX Keys / MX Master 3S allowlist only. The vendor HID++ collection is used; key reports are never opened.
public class KeyboardControl {
  static bool Mouse=false;
  [StructLayout(LayoutKind.Sequential)] struct InterfaceData { public int size; public Guid guid; public int flags; public IntPtr reserved; }
  [StructLayout(LayoutKind.Sequential)] struct Attributes { public int size; public ushort vendor,product,version; }
  [StructLayout(LayoutKind.Sequential)] struct Caps {
    public ushort usage,page,input,output,feature;
    [MarshalAs(UnmanagedType.ByValArray,SizeConst=17)] public ushort[] reserved;
    public ushort links,ib,iv,id,ob,ov,od,fb,fv,fd;
  }
  [DllImport("hid.dll")] static extern void HidD_GetHidGuid(out Guid guid);
  [DllImport("hid.dll")] static extern bool HidD_GetAttributes(SafeFileHandle h,ref Attributes a);
  [DllImport("hid.dll")] static extern bool HidD_GetPreparsedData(SafeFileHandle h,out IntPtr data);
  [DllImport("hid.dll")] static extern bool HidD_FreePreparsedData(IntPtr data);
  [DllImport("hid.dll")] static extern int HidP_GetCaps(IntPtr data,out Caps caps);
  [DllImport("setupapi.dll",CharSet=CharSet.Unicode)] static extern IntPtr SetupDiGetClassDevs(ref Guid guid,string enumerator,IntPtr window,uint flags);
  [DllImport("setupapi.dll")] static extern bool SetupDiEnumDeviceInterfaces(IntPtr set,IntPtr device,ref Guid guid,uint index,ref InterfaceData info);
  [DllImport("setupapi.dll",CharSet=CharSet.Unicode)] static extern bool SetupDiGetDeviceInterfaceDetail(IntPtr set,ref InterfaceData info,IntPtr detail,uint size,out uint needed,IntPtr device);
  [DllImport("setupapi.dll")] static extern bool SetupDiDestroyDeviceInfoList(IntPtr set);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern SafeFileHandle CreateFile(string name,uint access,uint share,IntPtr security,uint disposition,uint flags,IntPtr template);
  [DllImport("kernel32.dll")] static extern bool CancelIoEx(SafeFileHandle handle,IntPtr overlapped);
  static IEnumerable<string> Paths(){
    Guid guid;HidD_GetHidGuid(out guid);IntPtr set=SetupDiGetClassDevs(ref guid,null,IntPtr.Zero,0x12);
    if(set==new IntPtr(-1))yield break;
    try{for(uint index=0;index<512;index++){
      InterfaceData info=new InterfaceData();info.size=Marshal.SizeOf(info);
      if(!SetupDiEnumDeviceInterfaces(set,IntPtr.Zero,ref guid,index,ref info))break;
      uint needed;SetupDiGetDeviceInterfaceDetail(set,ref info,IntPtr.Zero,0,out needed,IntPtr.Zero);
      if(needed<8||needed>16384)continue;IntPtr detail=Marshal.AllocHGlobal((int)needed);
      try{Marshal.WriteInt32(detail,IntPtr.Size==8?8:6);if(SetupDiGetDeviceInterfaceDetail(set,ref info,detail,needed,out needed,IntPtr.Zero))yield return Marshal.PtrToStringUni(IntPtr.Add(detail,4));}finally{Marshal.FreeHGlobal(detail);}
    }}finally{SetupDiDestroyDeviceInfoList(set);}
  }
  static Dictionary<string,object> Result(string status){return new Dictionary<string,object>{{"status",status},{"device",Mouse?"MX Master 3S":"MX Keys"}};}
  static byte[] Query(FileStream stream,SafeFileHandle handle,Caps caps,byte feature,byte p0,byte p1){
    byte[] packet=new byte[Math.Max(20,(int)caps.output)];packet[0]=0x11;packet[1]=0xff;packet[2]=feature;packet[3]=0x0a;packet[4]=p0;packet[5]=p1;
    var write=stream.WriteAsync(packet,0,packet.Length);if(!write.Wait(1500)){CancelIoEx(handle,IntPtr.Zero);return null;}
    DateTime end=DateTime.UtcNow.AddSeconds(2);
    while(DateTime.UtcNow<end){
      byte[] data=new byte[Math.Max(20,(int)caps.input)];var read=stream.ReadAsync(data,0,data.Length);
      if(!read.Wait(250)){CancelIoEx(handle,IntPtr.Zero);try{if(!read.Wait(500))throw new IOException("Keyboard read cancellation timed out");}catch(AggregateException){}continue;}
      if(read.Result<7||data[0]!=0x11||data[1]!=0xff)continue;
      if(data[2]==0xff&&data[3]==feature&&data[4]==0x0a)return null;
      if(data[2]==feature&&data[3]==0x0a)return data;
    }return null;
  }
  static Dictionary<string,object> Probe(int target){
    foreach(string path in Paths()){
      using(SafeFileHandle meta=CreateFile(path,0,3,IntPtr.Zero,3,0,IntPtr.Zero)){
        if(meta.IsInvalid)continue;Attributes attr=new Attributes();attr.size=Marshal.SizeOf(attr);
        if(!HidD_GetAttributes(meta,ref attr)||attr.vendor!=0x046d||attr.product!=(Mouse?0xb034:0xb35b))continue;
        IntPtr preparsed;if(!HidD_GetPreparsedData(meta,out preparsed))continue;Caps caps;
        try{if(HidP_GetCaps(preparsed,out caps)!=0x110000)continue;}finally{HidD_FreePreparsedData(preparsed);}
        if(caps.page!=0xff43||caps.usage!=0x0202||caps.input<20||caps.output<20||caps.input>512||caps.output>512)continue;
        using(SafeFileHandle handle=CreateFile(path,0xc0000000,3,IntPtr.Zero,3,0x40000000,IntPtr.Zero)){
          if(handle.IsInvalid)return Result("open-failed");
          using(FileStream stream=new FileStream(handle,FileAccess.ReadWrite,1,true)){
            byte[] root=Query(stream,handle,caps,0,0x18,0x14);if(root==null)return Result("no-response");byte feature=root[4];if(feature==0)return Result("unsupported");
            byte[] hosts=Query(stream,handle,caps,feature,0,0);if(hosts==null)return Result("no-response");int count=hosts[4],current=hosts[5]+1;
            if(count<1||count>3||current<1||current>count)return Result("no-response");
            var result=Result("ready");result["channels"]=count;result["currentChannel"]=current;
            if(target>0&&target!=current){
              if(target>count)throw new Exception("Invalid target channel");
              byte[] packet=new byte[caps.output];packet[0]=0x11;packet[1]=0xff;packet[2]=feature;packet[3]=0x1a;packet[4]=(byte)(target-1);
              var write=stream.WriteAsync(packet,0,packet.Length);if(!write.Wait(1500)){CancelIoEx(handle,IntPtr.Zero);throw new Exception("Keyboard write timed out");}
              result["status"]="sent";result["targetChannel"]=target;
            }return result;
          }
        }
      }
    }return Result("not-connected");
  }
  public static int Main(string[] args){try{
    if(args.Length>0&&args[0]=="mouse"){Mouse=true;string[] rest=new string[args.Length-1];Array.Copy(args,1,rest,0,rest.Length);args=rest;}
    int target=0;if(args.Length==2&&args[0]=="switch"){if(!int.TryParse(args[1],out target)||target<1||target>3)throw new Exception("Invalid target channel");}
    else if(args.Length!=1||args[0]!="inspect")throw new Exception("Unknown command");
    Console.WriteLine(new JavaScriptSerializer().Serialize(Probe(target)));return 0;
  }catch(Exception e){Console.Error.WriteLine(e.Message);return 1;}}
}
