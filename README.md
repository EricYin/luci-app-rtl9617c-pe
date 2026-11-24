# luci-app-rtl9617c-pe

Standalone LuCI dashboard and mode-switching control panel for Realtek RTL9617C (Taurus) PE0 / PE1 Taroko coprocessors.

## Features

- Live PE core frequency (`800 MHz`) and PE AXI bus frequency (`400 MHz`) display.
- Per-core (`PE0` / `PE1`) real-time utilization bars, `PrId`, uptime, watchdog heartbeat, and on-demand MIPS-I self-test.
- Operating mode selector (`节能关闭` / `通用数据面卸载` / `Wi-Fi 硬件卸载`, auto-detecting wireless hardware).
- Feature occupancy table showing which non-exclusive offload features are running on which PE core, per-feature utilization / packets / bytes, deep links to owning pages, per-feature one-click disable, and a global one-click release & power-down button.
- Live PE ring buffer log viewer.
