import {
  ArrowRight,
  Calculator,
  CheckCircle2,
  Minus,
  Package,
  Plus,
  Search,
  ShoppingCart,
  Trash2,
  Wrench,
  X,
  Zap,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { calculateStoreOrderTotals, formatNgn } from '../lib/solar';
import type {
  CatalogItem,
  CatalogItemType,
  OrderDeliveryMethod,
  OrderPaymentMethod,
} from '../lib/types';

interface StorefrontViewProps {
  catalog: CatalogItem[];
  onUseInEstimator: (item: CatalogItem) => void;
  onOpenEstimator: () => void;
  onTrackOrder: (refCode: string) => void;
}

interface CartEntry {
  sku: string;
  qty: number;
}

const CART_STORAGE_KEY = 'hiso_store_cart';

function readStoredCart(): CartEntry[] {
  try {
    const raw = window.localStorage.getItem(CART_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((x) => x && typeof x.sku === 'string' && Number(x.qty) > 0)
      : [];
  } catch {
    return [];
  }
}

export function StorefrontView({
  catalog,
  onUseInEstimator,
  onOpenEstimator,
  onTrackOrder,
}: StorefrontViewProps) {
  const [typeFilter, setTypeFilter] = useState<'all' | CatalogItemType>('all');
  const [search, setSearch] = useState('');

  // Persistent Store cart.
  const [cart, setCart] = useState<CartEntry[]>(() => readStoredCart());
  const [cartOpen, setCartOpen] = useState(false);

  // Checkout Form
  const [customerName, setCustomerName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [location, setLocation] = useState('');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [deliveryMethod, setDeliveryMethod] = useState<OrderDeliveryMethod>('Nationwide Delivery');
  const [paymentMethod, setPaymentMethod] = useState<OrderPaymentMethod>('Bank Transfer on Invoice');
  const [notes, setNotes] = useState('');
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [checkoutError, setCheckoutError] = useState('');
  const [placedOrder, setPlacedOrder] = useState<{
    orderCode: string;
    refCode: string;
    totalNgn: number;
  } | null>(null);

  useEffect(() => {
    try {
      window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
    } catch {
      // Ignore storage quota errors
    }
  }, [cart]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return catalog.filter((item) => {
      if (typeFilter !== 'all' && item.itemType !== typeFilter) return false;
      if (!q) return true;
      return (
        item.name.toLowerCase().includes(q) ||
        item.sku.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q)
      );
    });
  }, [catalog, typeFilter, search]);

  const counts = useMemo(() => {
    return {
      all: catalog.length,
      equipment: catalog.filter((c) => c.itemType === 'equipment').length,
      service: catalog.filter((c) => c.itemType === 'service').length,
      appliance: catalog.filter((c) => c.itemType === 'appliance').length,
    };
  }, [catalog]);

  const cartTotals = useMemo(
    () => calculateStoreOrderTotals(cart, deliveryMethod, catalog, 7.5),
    [cart, deliveryMethod, catalog]
  );

  const totalCartItems = useMemo(
    () => cartTotals.resolvedItems.reduce((sum, it) => sum + it.qty, 0),
    [cartTotals.resolvedItems]
  );

  function addToCart(sku: string) {
    setPlacedOrder(null);
    setCheckoutError('');
    setCart((prev) => {
      const existing = prev.find((c) => c.sku === sku);
      if (existing) {
        return prev.map((c) => (c.sku === sku ? { ...c, qty: Math.min(999, c.qty + 1) } : c));
      }
      return [...prev, { sku, qty: 1 }];
    });
  }

  function setCartQty(sku: string, nextQty: number) {
    if (nextQty <= 0) {
      setCart((prev) => prev.filter((c) => c.sku !== sku));
      return;
    }
    setCart((prev) => prev.map((c) => (c.sku === sku ? { ...c, qty: Math.min(999, nextQty) } : c)));
  }

  async function handlePlaceOrder(e: React.FormEvent) {
    e.preventDefault();
    setCheckoutError('');
    if (cartTotals.resolvedItems.length === 0) {
      setCheckoutError('Your cart is empty. Add at least one item before placing an order.');
      return;
    }
    if (!customerName.trim() || !phone.trim() || !(deliveryAddress.trim() || location.trim())) {
      setCheckoutError('Customer name, phone number, and delivery address are required.');
      return;
    }

    setCheckoutBusy(true);
    try {
      const created = await api.submitStoreOrder({
        customerName: customerName.trim(),
        email: email.trim(),
        phone: phone.trim(),
        location: location.trim() || deliveryAddress.trim(),
        deliveryAddress:
          deliveryMethod === 'Abuja Warehouse Pickup' && !deliveryAddress.trim()
            ? 'No. 5 Adamu Fika Street, Life Camp, Abuja (Warehouse Pickup)'
            : deliveryAddress.trim() || location.trim(),
        deliveryMethod,
        paymentMethod,
        notes: notes.trim(),
        items: cartTotals.resolvedItems.map((it) => ({ sku: it.sku, qty: it.qty })),
      });
      setPlacedOrder({
        orderCode: created.orderCode,
        refCode: created.refCode,
        totalNgn: created.totalNgn,
      });
      setCart([]);
      setNotes('');
    } catch (err) {
      setCheckoutError((err as Error).message);
    } finally {
      setCheckoutBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-6 dark:border-slate-800">
        <div className="min-w-0">
          <p className="text-xs font-semibold tracking-wider text-[#D61F26]">
            HI-SOTECH STORE &amp; ORDER DESK
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-[#081E3E] sm:text-3xl dark:text-white">
            Solar Equipment, Appliances &amp; Engineering Services
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-600 dark:text-slate-300">
            Order verified solar hardware directly or send items to the offline Load Estimator for full system sizing.
          </p>
        </div>

        <div className="flex w-full flex-wrap items-center gap-2.5 sm:w-auto">
          <button
            type="button"
            onClick={() => setCartOpen(true)}
            className="inline-flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-[#D61F26] px-4 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-[#B0171D] sm:flex-initial"
          >
            <ShoppingCart className="h-4 w-4" />
            <span>
              Cart ({totalCartItems})
              {cartTotals.subtotalNgn > 0 ? ` · ${formatNgn(cartTotals.subtotalNgn)}` : ''}
            </span>
          </button>

          <button
            type="button"
            onClick={onOpenEstimator}
            className="inline-flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-[#081E3E] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#0F2D59] sm:flex-initial dark:border dark:border-slate-700"
          >
            <Calculator className="h-4 w-4" />
            Load Estimator
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Filters & Search */}
      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="flex flex-wrap items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-[#0B1D39]">
          {(
            [
              { id: 'all', label: `All (${counts.all})` },
              { id: 'equipment', label: `Solar Equipment (${counts.equipment})` },
              { id: 'appliance', label: `Appliances (${counts.appliance})` },
              { id: 'service', label: `Services (${counts.service})` },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setTypeFilter(tab.id)}
              className={`rounded-md px-3 py-2 text-xs font-semibold whitespace-nowrap transition-colors ${
                typeFilter === tab.id
                  ? 'bg-white text-[#081E3E] shadow-sm dark:bg-[#061327] dark:text-white'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <label className="relative block w-full sm:w-72">
          <span className="sr-only">Search Store catalogue</span>
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search SKU, inverter, appliance..."
            className="w-full rounded-lg border border-slate-300 bg-white py-2 pr-3 pl-9 text-sm text-slate-900 focus:border-[#081E3E] focus:outline-none dark:border-slate-700 dark:bg-[#0B1D39] dark:text-white"
          />
        </label>
      </div>

      {/* Product Grid */}
      {filtered.length === 0 ? (
        <div className="mt-8 rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-[#0B1D39]">
          No catalogue items match your current filter. Try resetting your search query.
        </div>
      ) : (
        <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((item) => {
            const inCart = cart.find((c) => c.sku === item.sku);
            const isSmartHardware = item.itemType === 'equipment'
              && /inverter|batter/i.test(`${item.category} ${item.name}`);
            return (
              <article
                key={item.sku}
                className="product-card group flex flex-col justify-between overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-[#0B1D39]"
              >
                <div>
                  <div className="relative aspect-[4/3] overflow-hidden bg-slate-100 dark:bg-slate-800">
                    {item.imagePath ? (
                      <img
                        src={item.imagePath}
                        alt={item.name}
                        className="h-full w-full object-cover"
                        referrerPolicy="no-referrer"
                        loading="lazy"
                        decoding="async"
                      />
                    ) : (
                      <div className="flex h-full w-full flex-col items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200 p-6 text-slate-500 dark:from-slate-800 dark:to-slate-900">
                        <Package className="h-8 w-8" />
                        <span className="mt-2 text-xs font-medium">{item.name}</span>
                      </div>
                    )}
                    {isSmartHardware && (
                      <span className="absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-full border border-emerald-200/60 bg-slate-950/75 px-2.5 py-1 text-[9px] font-bold tracking-wider text-emerald-100 backdrop-blur">
                        <span className="status-led h-1.5 w-1.5 rounded-full bg-emerald-400" />
                        SPEC PROFILE
                      </span>
                    )}
                  </div>

                  <div className="p-5">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                      <span className="font-mono-num font-semibold text-[#D61F26]">{item.sku}</span>
                      <span aria-hidden="true">·</span>
                      <span className="capitalize">{item.itemType}</span>
                      <span aria-hidden="true">·</span>
                      <span>{item.category}</span>
                    </div>
                    <h2 className="mt-1.5 text-lg font-bold text-[#081E3E] dark:text-white">{item.name}</h2>
                    {item.description && (
                      <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                        {item.description}
                      </p>
                    )}

                    <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
                      {item.capacityKw !== null && (
                        <span className="font-mono-num inline-flex items-center gap-1">
                          <Zap className="h-3.5 w-3.5 text-[#D61F26]" />
                          {item.capacityKw} kW Capacity
                        </span>
                      )}
                      {item.watts !== null && (
                        <span className="font-mono-num inline-flex items-center gap-1">
                          <Zap className="h-3.5 w-3.5 text-[#D61F26]" />
                          {item.watts} W Load
                        </span>
                      )}
                      <span>
                        {item.stockQty === 999 ? 'Service / Engineering' : `${item.stockQty} ${item.unit} available`}
                      </span>
                    </div>
                    {isSmartHardware && (
                      <div className="product-spec-reveal mt-3 overflow-hidden rounded-lg border border-emerald-200/70 bg-emerald-50/70 px-3 text-xs text-emerald-950 dark:border-emerald-900/70 dark:bg-emerald-950/20 dark:text-emerald-100">
                        <div className="flex flex-wrap gap-x-3 gap-y-1 py-2">
                          {item.grade && <span>{item.grade} grade</span>}
                          {item.capacityKw !== null && <span>{item.capacityKw} {item.category.toLowerCase().includes('batter') ? 'kWh storage' : 'kW capacity'}</span>}
                          {item.watts !== null && <span>{item.watts}W rated</span>}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="border-t border-slate-100 bg-slate-50/80 px-5 py-4 dark:border-slate-800 dark:bg-[#061327]/70">
                  <div className="flex items-baseline justify-between gap-2">
                    <div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">Per {item.unit}</div>
                      <div className="font-mono-num text-lg font-bold text-[#081E3E] dark:text-white">
                        {formatNgn(item.priceNgn)}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => onUseInEstimator(item)}
                      className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 hover:border-[#081E3E] hover:text-[#081E3E] dark:border-slate-700 dark:bg-[#0B1D39] dark:text-slate-200"
                    >
                      <Wrench className="h-3 w-3" />
                      {item.itemType === 'appliance' ? '+ Load' : 'Estimate'}
                    </button>
                  </div>

                  <div className="mt-3">
                    {inCart ? (
                      <div className="flex items-center justify-between gap-2 rounded-lg border border-[#D61F26] bg-white p-1 dark:bg-[#0B1D39]">
                        <button
                          type="button"
                          aria-label={`Decrease quantity for ${item.name}`}
                          onClick={() => setCartQty(item.sku, inCart.qty - 1)}
                          className="inline-flex h-8 w-9 items-center justify-center rounded-md text-[#081E3E] hover:bg-slate-100 dark:text-white dark:hover:bg-slate-800"
                        >
                          <Minus className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setCartOpen(true)}
                          className="font-mono-num flex-1 text-center text-xs font-bold text-[#D61F26]"
                        >
                          {inCart.qty} in Cart · Checkout
                        </button>
                        <button
                          type="button"
                          aria-label={`Increase quantity for ${item.name}`}
                          onClick={() => setCartQty(item.sku, inCart.qty + 1)}
                          className="inline-flex h-8 w-9 items-center justify-center rounded-md text-[#081E3E] hover:bg-slate-100 dark:text-white dark:hover:bg-slate-800"
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => addToCart(item.sku)}
                        className="inline-flex w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-[#D61F26] px-4 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-[#B0171D]"
                      >
                        <ShoppingCart className="h-3.5 w-3.5" />
                        Add to Cart
                      </button>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Store Cart & Checkout Drawer */}
      {cartOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Store Cart & Checkout"
          className="fixed inset-0 z-50 flex justify-end bg-black/60"
        >
          <div className="flex h-full w-full max-w-lg flex-col bg-white shadow-xl dark:bg-[#0B1D39]">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <ShoppingCart className="h-5 w-5 text-[#D61F26]" />
                <h2 className="text-base font-bold text-[#081E3E] dark:text-white">
                  Store Order Cart ({totalCartItems})
                </h2>
              </div>
              <button
                type="button"
                aria-label="Close cart"
                onClick={() => setCartOpen(false)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              {placedOrder ? (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-6 text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-100">
                  <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300">
                    <CheckCircle2 className="h-6 w-6 shrink-0" />
                    <h3 className="text-lg font-bold">Order Received by HI-SOTECH</h3>
                  </div>
                  <p className="mt-2 text-sm">
                    Your order has been logged with our Abuja procurement &amp; dispatch desk.
                  </p>
                  <dl className="mt-4 space-y-2 rounded-lg bg-white/80 p-4 text-xs dark:bg-[#061327]">
                    <div className="flex justify-between">
                      <dt className="text-slate-500">Order Code</dt>
                      <dd className="font-mono-num font-bold text-[#D61F26]">{placedOrder.orderCode}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-slate-500">Tracking Reference</dt>
                      <dd className="font-mono-num font-bold text-[#081E3E] dark:text-white">
                        {placedOrder.refCode}
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-slate-500">Order Total (incl. 7.5% VAT)</dt>
                      <dd className="font-mono-num font-bold text-[#081E3E] dark:text-white">
                        {formatNgn(placedOrder.totalNgn)}
                      </dd>
                    </div>
                  </dl>

                  <div className="mt-5 flex flex-col gap-2 sm:flex-row">
                    <button
                      type="button"
                      onClick={() => {
                        const code = placedOrder.orderCode;
                        setCartOpen(false);
                        onTrackOrder(code);
                      }}
                      className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[#081E3E] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#D61F26]"
                    >
                      Track Order Status
                      <ArrowRight className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPlacedOrder(null);
                        setCartOpen(false);
                      }}
                      className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:bg-[#061327] dark:text-slate-200"
                    >
                      Continue Shopping
                    </button>
                  </div>
                </div>
              ) : cartTotals.resolvedItems.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                  <Package className="mx-auto h-8 w-8 text-slate-400" />
                  <p className="mt-3 font-medium">Your Store cart is empty.</p>
                  <p className="mt-1 text-xs">Add solar panels, inverters, batteries, or appliances to place an order.</p>
                </div>
              ) : (
                <div className="space-y-6">
                  {/* Cart Items */}
                  <div className="space-y-3">
                    {cartTotals.resolvedItems.map((it) => (
                      <div
                        key={it.sku}
                        className="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-[#061327]"
                      >
                        {it.imagePath && (
                          <img
                            src={it.imagePath}
                            alt={it.name}
                            className="h-14 w-16 shrink-0 rounded-md object-cover"
                            loading="lazy"
                            decoding="async"
                          />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="font-mono-num text-[11px] font-semibold text-[#D61F26]">{it.sku}</div>
                          <div className="truncate text-sm font-bold text-[#081E3E] dark:text-white">{it.name}</div>
                          <div className="font-mono-num text-xs text-slate-500">
                            {formatNgn(it.unitPriceNgn)} / {it.unit}
                          </div>

                          <div className="mt-2 flex items-center justify-between gap-2">
                            <div className="inline-flex items-center rounded-md border border-slate-300 bg-white dark:border-slate-700 dark:bg-[#0B1D39]">
                              <button
                                type="button"
                                aria-label={`Decrease quantity for ${it.name}`}
                                onClick={() => setCartQty(it.sku, it.qty - 1)}
                                className="px-2 py-1 text-slate-600 hover:text-[#D61F26] dark:text-slate-300"
                              >
                                <Minus className="h-3 w-3" />
                              </button>
                              <span className="font-mono-num px-2 text-xs font-bold">{it.qty}</span>
                              <button
                                type="button"
                                aria-label={`Increase quantity for ${it.name}`}
                                onClick={() => setCartQty(it.sku, it.qty + 1)}
                                className="px-2 py-1 text-slate-600 hover:text-[#D61F26] dark:text-slate-300"
                              >
                                <Plus className="h-3 w-3" />
                              </button>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="font-mono-num text-xs font-bold text-[#081E3E] dark:text-white">
                                {formatNgn(it.qty * it.unitPriceNgn)}
                              </span>
                              <button
                                type="button"
                                aria-label={`Remove ${it.name} from cart`}
                                onClick={() => setCartQty(it.sku, 0)}
                                className="p-1 text-slate-400 hover:text-[#D61F26]"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Delivery Option & Pricing Summary */}
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs dark:border-slate-800 dark:bg-[#061327]">
                    <div className="font-bold text-[#081E3E] dark:text-white">Fulfilment Method</div>
                    <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {(
                        [
                          { id: 'Nationwide Delivery', sub: '₦25,000 (Free ≥ ₦5M)' },
                          { id: 'Abuja Warehouse Pickup', sub: 'Free · Life Camp, Abuja' },
                        ] as const
                      ).map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => setDeliveryMethod(opt.id)}
                          className={`rounded-lg border p-2.5 text-left transition-colors ${
                            deliveryMethod === opt.id
                              ? 'border-[#D61F26] bg-[#081E3E] text-white'
                              : 'border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-[#0B1D39] dark:text-slate-300'
                          }`}
                        >
                          <div className="font-semibold">{opt.id}</div>
                          <div className="mt-0.5 text-[11px] opacity-80">{opt.sub}</div>
                        </button>
                      ))}
                    </div>

                    <dl className="mt-4 space-y-1.5 border-t border-slate-200 pt-3 dark:border-slate-700">
                      <div className="flex justify-between">
                        <dt className="text-slate-500">Items Subtotal</dt>
                        <dd className="font-mono-num font-semibold">{formatNgn(cartTotals.subtotalNgn)}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-slate-500">Logistics / Delivery</dt>
                        <dd className="font-mono-num font-semibold">
                          {cartTotals.deliveryFeeNgn === 0 ? 'Free' : formatNgn(cartTotals.deliveryFeeNgn)}
                        </dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-slate-500">VAT (7.5%)</dt>
                        <dd className="font-mono-num font-semibold">{formatNgn(cartTotals.taxNgn)}</dd>
                      </div>
                      <div className="flex justify-between border-t border-slate-200 pt-2 text-sm font-bold text-[#081E3E] dark:border-slate-700 dark:text-white">
                        <dt>Order Total</dt>
                        <dd className="font-mono-num text-[#D61F26]">{formatNgn(cartTotals.totalNgn)}</dd>
                      </div>
                    </dl>
                  </div>

                  {/* Checkout Form */}
                  <form onSubmit={handlePlaceOrder} className="space-y-3 text-sm">
                    <h3 className="text-sm font-bold text-[#081E3E] dark:text-white">
                      Customer &amp; Delivery Details
                    </h3>

                    {checkoutError && (
                      <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/60 dark:text-red-300">
                        {checkoutError}
                      </p>
                    )}

                    <label className="block">
                      <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
                        Full Name / Organization *
                      </span>
                      <input
                        type="text"
                        required
                        value={customerName}
                        onChange={(e) => setCustomerName(e.target.value)}
                        placeholder="e.g. Sadiq Musa"
                        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-[#061327]"
                      />
                    </label>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="block">
                        <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
                          WhatsApp Number *
                        </span>
                        <input
                          type="tel"
                          required
                          value={phone}
                          onChange={(e) => setPhone(e.target.value)}
                          placeholder="+2348030000000"
                          className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-[#061327]"
                        />
                      </label>
                      <label className="block">
                        <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Email</span>
                        <input
                          type="email"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          placeholder="you@domain.com"
                          className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-[#061327]"
                        />
                      </label>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="block">
                        <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
                          City / State *
                        </span>
                        <input
                          type="text"
                          required
                          value={location}
                          onChange={(e) => setLocation(e.target.value)}
                          placeholder="e.g. Wuse 2, Abuja"
                          className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-[#061327]"
                        />
                      </label>
                      <label className="block">
                        <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
                          Payment Preference
                        </span>
                        <select
                          value={paymentMethod}
                          onChange={(e) => setPaymentMethod(e.target.value as OrderPaymentMethod)}
                          className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-[#061327]"
                        >
                          <option value="Bank Transfer on Invoice">Bank Transfer on Invoice</option>
                          <option value="Pay on Delivery (Abuja)">Pay on Delivery (Abuja)</option>
                        </select>
                      </label>
                    </div>

                    <label className="block">
                      <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
                        {deliveryMethod === 'Abuja Warehouse Pickup'
                          ? 'Pickup Contact / Preferred Date *'
                          : 'Street Delivery Address *'}
                      </span>
                      <input
                        type="text"
                        required
                        value={deliveryAddress}
                        onChange={(e) => setDeliveryAddress(e.target.value)}
                        placeholder={
                          deliveryMethod === 'Abuja Warehouse Pickup'
                            ? 'e.g. Pickup tomorrow at Life Camp warehouse'
                            : 'House / Plot number, street, landmark...'
                        }
                        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-[#061327]"
                      />
                    </label>

                    <label className="block">
                      <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Order Notes</span>
                      <textarea
                        rows={2}
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder="Request installation bundle or delivery instructions..."
                        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-[#061327]"
                      />
                    </label>

                    <button
                      type="submit"
                      disabled={checkoutBusy}
                      className="w-full rounded-lg bg-[#D61F26] px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#B0171D] disabled:opacity-60"
                    >
                      {checkoutBusy
                        ? 'Submitting Order...'
                        : `Place Store Order · ${formatNgn(cartTotals.totalNgn)}`}
                    </button>
                  </form>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
