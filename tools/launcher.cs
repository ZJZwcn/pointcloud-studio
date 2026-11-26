// 点云实验室 · POINT CLOUD STUDIO —— Windows 启动器
//
// 双击运行：找 Node → 起 server/index.mjs → 等服务监听 → 打开浏览器。
// 编译：csc /target:exe /win32icon:public\app.ico /out:点云实验室.exe tools\launcher.cs
// 环境变量 PCS_PORT 可改端口（默认 5183），--no-browser 只起服务不开浏览器。
using System;
using System.Diagnostics;
using System.IO;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

static class Launcher
{
    const int DEFAULT_PORT = 5183;

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    static extern int MessageBoxW(IntPtr hWnd, string text, string caption, uint type);

    static void Say(string s) { Console.WriteLine("  " + s); }

    static void Fatal(string title, string msg)
    {
        Console.WriteLine();
        Console.WriteLine("  [x] " + title);
        Console.WriteLine();
        foreach (string line in msg.Split('\n')) Console.WriteLine("      " + line);
        Console.WriteLine();
        try { MessageBoxW(IntPtr.Zero, msg, title, 0x10u); } catch { }
        Console.WriteLine("  按回车退出…");
        try { Console.ReadLine(); } catch { }
    }

    static string FindNode()
    {
        // 1) PATH
        string path = Environment.GetEnvironmentVariable("PATH");
        if (!string.IsNullOrEmpty(path))
        {
            foreach (string raw in path.Split(';'))
            {
                string dir = raw.Trim().Trim('"');
                if (dir.Length == 0) continue;
                try
                {
                    string p = Path.Combine(dir, "node.exe");
                    if (File.Exists(p)) return p;
                }
                catch { }
            }
        }
        // 2) 默认安装位置
        string[] fixedPaths = new string[]
        {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "nodejs", "node.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "nodejs", "node.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "nodejs", "node.exe"),
            @"C:\Program Files\nodejs\node.exe"
        };
        foreach (string p in fixedPaths)
        {
            try { if (File.Exists(p)) return p; } catch { }
        }
        return null;
    }

    static bool PortOpen(int port)
    {
        try
        {
            using (TcpClient c = new TcpClient())
            {
                IAsyncResult ar = c.BeginConnect("127.0.0.1", port, null, null);
                if (!ar.AsyncWaitHandle.WaitOne(400)) return false;
                c.EndConnect(ar);
                return true;
            }
        }
        catch { return false; }
    }

    static void OpenBrowser(string url)
    {
        try
        {
            ProcessStartInfo psi = new ProcessStartInfo(url);
            psi.UseShellExecute = true;
            Process.Start(psi);
        }
        catch (Exception e) { Say("打不开浏览器：" + e.Message + " —— 手动访问 " + url); }
    }

    static int Main(string[] args)
    {
        try { Console.OutputEncoding = Encoding.UTF8; } catch { }
        Console.Title = "点云实验室 · POINT CLOUD STUDIO";

        bool noBrowser = false;
        foreach (string a in args)
        {
            if (a == "--no-browser" || a == "-n") noBrowser = true;
        }

        int port = DEFAULT_PORT;
        string envPort = Environment.GetEnvironmentVariable("PCS_PORT");
        int parsed;
        if (!string.IsNullOrEmpty(envPort) && int.TryParse(envPort, out parsed) && parsed > 0) port = parsed;
        string url = "http://127.0.0.1:" + port + "/";

        string root = AppDomain.CurrentDomain.BaseDirectory;
        string server = Path.Combine(root, "server", "index.mjs");

        if (!File.Exists(server))
        {
            Fatal("文件缺失", "没找到 server\\index.mjs。\n\n请把这个 exe 放在解压后「点云实验室」文件夹的根目录里，和 dist、server 两个文件夹同级。");
            return 1;
        }

        // 已经开着一个就不要再起第二个
        if (PortOpen(port))
        {
            Say("端口 " + port + " 上已经有一个实例在跑，直接打开页面。");
            if (!noBrowser) OpenBrowser(url);
            return 0;
        }

        string node = FindNode();
        if (node == null)
        {
            Fatal("没找到 Node.js", "这个程序需要一个 Node.js 运行时（18 或更高）。\n\n1. 打开 https://nodejs.org/\n2. 下载 LTS 版本安装（一路下一步）\n3. 装完再双击一次这个 exe\n\n装过但刚装完还没重启的，注销或重启一次再来。");
            return 1;
        }

        Console.WriteLine();
        Console.WriteLine("  点云实验室 · POINT CLOUD STUDIO");
        Console.WriteLine("  ──────────────────────────────────────");
        Say("Node   " + node);
        Say("地址   " + url);
        Say("目录   " + root);
        Console.WriteLine();
        Say("正在启动…关掉这个窗口即停止服务。");
        Console.WriteLine();

        ProcessStartInfo sp = new ProcessStartInfo(node, "\"" + server + "\"");
        sp.WorkingDirectory = root;
        sp.UseShellExecute = false;
        if (port != DEFAULT_PORT) sp.EnvironmentVariables["PORT"] = port.ToString();

        Process proc;
        try { proc = Process.Start(sp); }
        catch (Exception e)
        {
            Fatal("启动失败", "无法执行 node：\n" + e.Message);
            return 1;
        }

        // 等服务真正开始监听再开浏览器（最多 25 秒，含大模型首次载入前的冷启动）
        bool up = false;
        for (int i = 0; i < 125; i++)
        {
            Thread.Sleep(200);
            if (proc.HasExited) break;
            if (PortOpen(port)) { up = true; break; }
        }

        if (up)
        {
            if (!noBrowser) OpenBrowser(url);
        }
        else if (proc.HasExited)
        {
            Fatal("服务没能起来", "server\\index.mjs 退出了，上面窗口里的报错就是原因。\n\n最常见的是端口 " + port + " 被别的程序占用，可以设环境变量 PCS_PORT 换一个端口再试。");
            return proc.ExitCode;
        }
        else
        {
            Say("等了一会儿没等到端口响应，先打开页面，可能还需要再刷新一下。");
            if (!noBrowser) OpenBrowser(url);
        }

        proc.WaitForExit();
        Console.WriteLine();
        Say("服务已停止。");
        return proc.ExitCode;
    }
}
