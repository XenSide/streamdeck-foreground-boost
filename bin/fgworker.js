// Worker: SetWinEventHook(EVENT_SYSTEM_FOREGROUND) + a blocking Windows message loop.
// Sleeps in GetMessageW (no CPU) and posts { pid } on every focus change. Sends { tid } first:
// the owner posts WM_QUIT to that thread on exit, otherwise GetMessageW would block shutdown.
const { parentPort, workerData } = require("worker_threads");
const k = require(workerData.koffi), u = k.load("user32.dll"), kr = k.load("kernel32.dll");
const Proc = k.proto("void __stdcall WinEventProc(void* hook, uint32 ev, void* hwnd, int32 obj, int32 child, uint32 thread, uint32 time)");
const SetWinEventHook = u.func("void* __stdcall SetWinEventHook(uint32, uint32, void*, WinEventProc*, uint32, uint32, uint32)"),
  GetMessageW = u.func("int32 __stdcall GetMessageW(_Out_ uint8* msg, void* hwnd, uint32, uint32)"),
  DispatchMessageW = u.func("intptr __stdcall DispatchMessageW(uint8* msg)"),
  GetForegroundWindow = u.func("void* __stdcall GetForegroundWindow()"),
  GetWindowThreadProcessId = u.func("uint32 __stdcall GetWindowThreadProcessId(void*, _Out_ uint32*)"),
  GetCurrentThreadId = kr.func("uint32 __stdcall GetCurrentThreadId()");
parentPort.postMessage({ tid: GetCurrentThreadId() });
const send = (h) => { const p = [0]; if (h) GetWindowThreadProcessId(h, p); if (p[0]) parentPort.postMessage({ pid: p[0] }); };
const cb = k.register((hook, ev, hwnd) => send(hwnd), k.pointer(Proc));
// 3 = EVENT_SYSTEM_FOREGROUND; 2 = WINEVENT_SKIPOWNPROCESS (out of context)
if (!SetWinEventHook(3, 3, null, cb, 0, 0, 2)) throw new Error("SetWinEventHook failed");
send(GetForegroundWindow());
const msg = Buffer.alloc(64);
while (GetMessageW(msg, null, 0, 0) > 0) DispatchMessageW(msg);
