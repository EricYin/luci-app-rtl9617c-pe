include $(TOPDIR)/rules.mk

LUCI_TITLE:=LuCI dashboard and control panel for RTL9617C PE0/PE1 coprocessors
LUCI_DEPENDS:=@TARGET_rtl9617c +luci-base +rtl9617c-pe-offload
LUCI_PKGARCH:=all
PKG_VERSION:=2.0.0
PKG_RELEASE:=1
PKG_LICENSE:=GPL-2.0-only

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
