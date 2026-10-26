using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.Web.Script.Serialization;
using Microsoft.Win32;

// A short-lived process isolates slow/blocked display drivers from the desktop UI.
public class DisplayDdc {
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
    public struct PhysicalMonitor { public IntPtr handle; [MarshalAs(UnmanagedType.ByValTStr, SizeConst=128)] public string description; }
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
    public struct MonitorInfo { public int size; public Rect monitor; public Rect work; public uint flags; [MarshalAs(UnmanagedType.ByValTStr, SizeConst=32)] public string device; }
    [StructLayout(LayoutKind.Sequential)] public struct Rect { public int left,top,right,bottom; }
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
    public struct DisplayDevice { public int cb; [MarshalAs(UnmanagedType.ByValTStr, SizeConst=32)] public string name; [MarshalAs(UnmanagedType.ByValTStr, SizeConst=128)] public string text; public int flags; [MarshalAs(UnmanagedType.ByValTStr, SizeConst=128)] public string id; [MarshalAs(UnmanagedType.ByValTStr, SizeConst=128)] public string key; }
    public delegate bool MonitorCallback(IntPtr mon, IntPtr dc, ref Rect rect, IntPtr data);
    [DllImport("user32.dll")] static extern bool EnumDisplayMonitors(IntPtr dc, IntPtr clip, MonitorCallback cb, IntPtr data);
    [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern bool GetMonitorInfo(IntPtr mon, ref MonitorInfo info);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern bool EnumDisplayDevices(string device, uint index, ref DisplayDevice dd, uint flags);
    [DllImport("dxva2.dll",SetLastError=true)] static extern bool GetNumberOfPhysicalMonitorsFromHMONITOR(IntPtr mon, out uint count);
    [DllImport("dxva2.dll",SetLastError=true)] static extern bool GetPhysicalMonitorsFromHMONITOR(IntPtr mon, uint count, [Out] PhysicalMonitor[] monitors);
    [DllImport("dxva2.dll")] static extern bool DestroyPhysicalMonitors(uint count, PhysicalMonitor[] monitors);
    [DllImport("dxva2.dll",SetLastError=true)] static extern bool GetVCPFeatureAndVCPFeatureReply(IntPtr mon, byte code, out uint type, out uint value, out uint max);
    [DllImport("dxva2.dll",SetLastError=true)] static extern bool SetVCPFeature(IntPtr mon, byte code, uint value);
    [DllImport("dxva2.dll",SetLastError=true)] static extern bool GetCapabilitiesStringLength(IntPtr mon, out uint len);
    [DllImport("dxva2.dll",SetLastError=true,CharSet=CharSet.Ansi)] static extern bool CapabilitiesRequestAndCapabilitiesReply(IntPtr mon, StringBuilder caps, uint len);

    static Dictionary<string,object> Identity(string device, uint index, string description) {
        DisplayDevice dd = new DisplayDevice(); dd.cb = Marshal.SizeOf(dd);
        EnumDisplayDevices(device,index,ref dd,1);
        string raw = dd.id ?? device;
        string model = description, serial = "";
        try {
            string reg = raw.StartsWith("MONITOR\\") ? "DISPLAY\\" + raw.Substring(8) : raw;
            if(raw.StartsWith("\\\\?\\")) { string[] parts=raw.Substring(4).Split('#'); if(parts.Length>=3) reg=parts[0]+"\\"+parts[1]+"\\"+parts[2]; }
            using (RegistryKey key = Registry.LocalMachine.OpenSubKey("SYSTEM\\CurrentControlSet\\Enum\\" + reg + "\\Device Parameters")) {
                byte[] edid = key == null ? null : key.GetValue("EDID") as byte[];
                if (edid != null && edid.Length >= 128) {
                    for(int p=54;p+18<=126;p+=18) {
                        if(edid[p]==0 && edid[p+1]==0 && edid[p+2]==0) {
                            string value = Encoding.ASCII.GetString(edid,p+5,13).Trim('\0','\n','\r',' ');
                            if(edid[p+3]==0xFC) model=value;
                            if(edid[p+3]==0xFF) serial=value;
                        }
                    }
                }
            }
        } catch { }
        return new Dictionary<string,object> { {"id",raw+":"+index}, {"name",model}, {"serial",serial}, {"connector",device}, {"description",description} };
    }

    public static int Main(string[] args) {
        try { SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch { }
        Console.OutputEncoding = new UTF8Encoding(false);
        var json = new JavaScriptSerializer();
        string command = args.Length>0 ? args[0] : "probe";
        if(command!="probe" && command!="status" && command!="set") { Console.Error.WriteLine("Expected probe, status or set"); return 2; }
        uint targetValue=0;
        if(command=="set" && (args.Length!=3 || !uint.TryParse(args[2],out targetValue) || targetValue<1 || targetValue>255)) return 2;
        var list = new List<Dictionary<string,object>>();
        bool found=false, written=false; int writeError=0;
        try {
            EnumDisplayMonitors(IntPtr.Zero,IntPtr.Zero,delegate(IntPtr mon,IntPtr dc,ref Rect rect,IntPtr data) {
                MonitorInfo info=new MonitorInfo(); info.size=Marshal.SizeOf(info); GetMonitorInfo(mon,ref info);
                uint count; if(!GetNumberOfPhysicalMonitorsFromHMONITOR(mon,out count) || count==0 || count>32) return true;
                PhysicalMonitor[] physical=new PhysicalMonitor[count];
                if(!GetPhysicalMonitorsFromHMONITOR(mon,count,physical)) return true;
                try {
                    for(uint i=0;i<count;i++) {
                        var row=Identity(info.device,i,physical[i].description);
                        row["primary"]=(info.flags & 1)!=0;
                        row["bounds"]=new {x=info.monitor.left,y=info.monitor.top,width=info.monitor.right-info.monitor.left,height=info.monitor.bottom-info.monitor.top};
                        if(command=="set") {
                            if((string)row["id"]==args[1]) { found=true; written=SetVCPFeature(physical[i].handle,0x60,targetValue); if(!written) writeError=Marshal.GetLastWin32Error(); }
                            continue;
                        }
                        uint type,value,max; bool readable=GetVCPFeatureAndVCPFeatureReply(physical[i].handle,0x60,out type,out value,out max);
                        row["input"]=readable ? (object)value : null;
                        row["readable"]=readable;
                        row["error"]=readable ? null : (object)Marshal.GetLastWin32Error();
                        if(command=="probe") {
                            uint length; string capabilities="";
                            if(GetCapabilitiesStringLength(physical[i].handle,out length) && length>0 && length<65536) {
                                var text=new StringBuilder((int)length);
                                if(CapabilitiesRequestAndCapabilitiesReply(physical[i].handle,text,length)) capabilities=text.ToString();
                            }
                            row["capabilities"]=capabilities;
                        }
                        list.Add(row);
                    }
                } finally { DestroyPhysicalMonitors(count,physical); }
                return true;
            },IntPtr.Zero);
            if(command=="set") {
                Console.WriteLine(json.Serialize(new { ok=written, found=found, error=writeError }));
                return written ? 0 : 1;
            }
            Console.WriteLine(json.Serialize(list)); return 0;
        } catch(Exception ex) { Console.WriteLine(json.Serialize(new { error=ex.Message })); return 1; }
    }
}
