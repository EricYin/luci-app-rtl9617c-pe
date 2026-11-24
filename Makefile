include $(TOPDIR)/rules.mk

LUCI_TITLE:=LuCI dashboard and control panel for RTL9617C PE0/PE1 coprocessors
LUCI_DEPENDS:=+luci-base +rtl9617c-pe-offload
PKG_VERSION:=1.0.0
PKG_RELEASE:=1
PKG_LICENSE:=GPL-2.0-only

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
