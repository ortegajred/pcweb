'use strict';
/* iWant PC - one script shared by every page. Each page sets <body data-page="..."> and gets its own init below.
   PRODUCTS live in Supabase (table: products). Users, cart, orders and bookings still live in localStorage. */

/* ===== Supabase connection ===== */
const SUPABASE_URL = 'https://gvrtyixxtmsaryrphxhu.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_uM3M9u329B9AjYI-K2eVrg_rQ90pObS';
const IMAGE_BUCKET = 'product-images';

/* Tiny PostgREST client (no library needed). path is relative to /rest/v1/ */
async function sb(path, { method = 'GET', body, prefer } = {}) {
    let res;
    try {
        res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
            method,
            headers: { apikey: SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) },
            body: body === undefined ? undefined : JSON.stringify(body)
        });
    } catch { throw new Error('Could not reach the database. Check your internet connection.'); }
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    if (!res.ok) {
        let msg = (data && (data.message || data.error)) || res.statusText || 'Request failed';
        if (/duplicate key/i.test(msg)) msg = 'A product with this name already exists.';
        if (/relation .* does not exist|schema cache/i.test(msg)) msg = 'The products table was not found. Run supabase_setup.sql in the Supabase SQL Editor first.';
        throw new Error(msg);
    }
    return data;
}

async function uploadProductImage(blob, name) {
    const slug = String(name || 'product').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 40) || 'product';
    const path = `${Date.now()}-${slug}.jpg`;
    let res;
    try {
        res = await fetch(`${SUPABASE_URL}/storage/v1/object/${IMAGE_BUCKET}/${path}`, {
            method: 'POST',
            headers: { apikey: SUPABASE_PUBLISHABLE_KEY, 'Content-Type': blob.type || 'image/jpeg', 'x-upsert': 'false' },
            body: blob
        });
    } catch { throw new Error('Image upload failed: could not reach Supabase Storage.'); }
    if (!res.ok) {
        let msg = res.statusText;
        try { const j = await res.json(); msg = j.message || j.error || msg; } catch { /* ignore */ }
        throw new Error('Image upload failed: ' + msg + '. Check the storage policies in supabase_setup.sql, or paste an image URL instead.');
    }
    return `${SUPABASE_URL}/storage/v1/object/public/${IMAGE_BUCKET}/${path}`;
}

/* ===== Constants & helpers ===== */
const KEY = {
    users: 'iwp_users', session: 'iwp_session', cart: 'iwp_cart', orders: 'iwp_orders', bookings: 'iwp_bookings',
    reports: 'iwp_reports', build: 'iwp_build', buildNote: 'iwp_build_note', prefill: 'iwp_booking_prefill'
};
const TAX_RATE = 0.08;
const SHIPPING_FEE = 15;
const ASSEMBLY_FEE = 50;
const ASSEMBLY_ID = 'svc-assembly';
const CATEGORIES = {
    processors: 'Processors',
    motherboards: 'Motherboards',
    memory: 'Memory',
    'graphics-cards': 'Graphics cards',
    'power-supplies': 'Power supplies'
};
const ORDER_STATUS = {
    pending:   { label: 'Pending Payment', icon: 'fa-hourglass-half' },
    toship:    { label: 'To Ship',         icon: 'fa-clock' },
    toreceive: { label: 'Shipped Out',     icon: 'fa-truck' },
    completed: { label: 'Delivered',       icon: 'fa-check' }
};

/* Technical specs per category. The staff form and the PC builder both read this one definition.
   type: number | select | combo (text with suggestions). unit is appended on product chips. */
const SPEC_FIELDS = {
    processors: [
        { key: 'socket', label: 'Socket', type: 'combo', options: ['AM4', 'AM5', 'LGA1200', 'LGA1700', 'LGA1851'], required: true },
        { key: 'memory_type', label: 'Supported memory', type: 'select', options: ['DDR4', 'DDR5', 'DDR4/DDR5'], required: true },
        { key: 'tdp', label: 'TDP (W)', type: 'number', unit: 'W', required: true },
        { key: 'cores', label: 'Cores', type: 'number', unit: ' cores' },
        { key: 'threads', label: 'Threads', type: 'number', unit: ' threads' },
        { key: 'boost_clock_ghz', label: 'Boost clock (GHz)', type: 'number', step: 0.1, unit: 'GHz' }
    ],
    motherboards: [
        { key: 'socket', label: 'Socket', type: 'combo', options: ['AM4', 'AM5', 'LGA1200', 'LGA1700', 'LGA1851'], required: true },
        { key: 'memory_type', label: 'Memory type', type: 'select', options: ['DDR4', 'DDR5'], required: true },
        { key: 'form_factor', label: 'Form factor', type: 'select', options: ['ATX', 'Micro-ATX', 'Mini-ITX', 'E-ATX'] },
        { key: 'chipset', label: 'Chipset', type: 'combo', options: ['A620', 'B550', 'B650', 'X670E', 'B760', 'Z690', 'Z790', 'Z890'] },
        { key: 'memory_slots', label: 'Memory slots', type: 'number', unit: ' slots' },
        { key: 'tdp', label: 'Board power draw (W)', type: 'number', unit: 'W' }
    ],
    memory: [
        { key: 'memory_type', label: 'Memory type', type: 'select', options: ['DDR4', 'DDR5'], required: true },
        { key: 'capacity_gb', label: 'Total capacity (GB)', type: 'number', unit: 'GB', required: true },
        { key: 'speed_mhz', label: 'Speed (MHz)', type: 'number', unit: 'MHz', required: true },
        { key: 'modules', label: 'Number of sticks', type: 'number', unit: ' sticks' },
        { key: 'tdp', label: 'Power draw (W)', type: 'number', unit: 'W' }
    ],
    'graphics-cards': [
        { key: 'chipset', label: 'GPU chipset', type: 'combo', options: ['GeForce RTX 4060', 'GeForce RTX 4070', 'GeForce RTX 4080', 'Radeon RX 7600', 'Radeon RX 7800 XT'] },
        { key: 'vram_gb', label: 'VRAM (GB)', type: 'number', unit: 'GB' },
        { key: 'tdp', label: 'Board power / TDP (W)', type: 'number', unit: 'W', required: true },
        { key: 'recommended_psu', label: 'Recommended PSU (W)', type: 'number', unit: 'W PSU' },
        { key: 'length_mm', label: 'Card length (mm)', type: 'number', unit: 'mm' }
    ],
    'power-supplies': [
        { key: 'wattage', label: 'Wattage (W)', type: 'number', unit: 'W', required: true },
        { key: 'efficiency', label: 'Efficiency rating', type: 'combo', options: ['80+ White', '80+ Bronze', '80+ Silver', '80+ Gold', '80+ Platinum', '80+ Titanium'] },
        { key: 'modular', label: 'Cabling', type: 'select', options: ['Non-modular', 'Semi-modular', 'Fully modular'] },
        { key: 'form_factor', label: 'Form factor', type: 'select', options: ['ATX', 'SFX', 'SFX-L'] }
    ]
};

const $ = (sel, root = document) => root.querySelector(sel); const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const write = (key, value) => localStorage.setItem(key, JSON.stringify(value));
const money = n => '₱' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = prefix => prefix + Date.now().toString().slice(-6);
const sameId = (a, b) => String(a) === String(b);

function totals(items) {
    const subtotal = items.reduce((sum, i) => sum + i.price * i.qty, 0);
    const tax = subtotal * TAX_RATE;
    const shipping = items.length ? SHIPPING_FEE : 0;
    return { subtotal, tax, shipping, total: subtotal + tax + shipping };
}

/* Product image placeholder (shown until staff add a real image) */
function placeholder() {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><rect width="400" height="300" fill="#1e293b"/>' +
        '<g fill="none" stroke="#475569" stroke-width="6" stroke-linejoin="round" stroke-linecap="round"><rect x="150" y="90" width="100" height="70" rx="8"/><path d="M175 190h50M200 160v30"/></g>' +
        '<text x="200" y="240" fill="#94a3b8" font-family="sans-serif" font-size="18" text-anchor="middle">No image yet</text></svg>';
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}
const productImg = p => (p && p.image) || placeholder();

function toast(message, type = 'ok') {
    let box = $('.toast-container');
    if (!box) { box = document.createElement('div'); box.className = 'toast-container'; document.body.append(box); }
    const el = document.createElement('div');
    el.className = 'toast ' + type;
    el.innerHTML = `<i class="fa-solid ${type === 'error' ? 'fa-circle-exclamation' : 'fa-circle-check'}"></i><span>${message}</span>`;
    box.append(el);
    setTimeout(() => { el.classList.add('hide'); setTimeout(() => el.remove(), 300); }, type === 'error' ? 4500 : 2500);
}

/* Resize a picked image to a JPEG blob (max side 900px) before uploading */
function resizeToBlob(file, max = 900) {
    return new Promise((resolve, reject) => {
        const img = new Image(), url = URL.createObjectURL(file);
        img.onload = () => {
            const scale = Math.min(1, max / Math.max(img.width, img.height));
            const canvas = document.createElement('canvas');
            canvas.width = Math.round(img.width * scale); canvas.height = Math.round(img.height * scale);
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            URL.revokeObjectURL(url);
            canvas.toBlob(b => b ? resolve(b) : reject(new Error('That image could not be processed.')), 'image/jpeg', 0.85);
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file could not be read as an image.')); };
        img.src = url;
    });
}

/* ===== Products (Supabase) ===== */
const normalizeProduct = r => ({
    ...r,
    price: Number(r.price) || 0,
    stock: Number(r.stock) || 0,
    description: r.description || '',
    image: r.image || '',
    specs: r.specs && typeof r.specs === 'object' && !Array.isArray(r.specs) ? r.specs : {}
});
const byCatTitle = (a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title);

const Products = {
    list: [],
    async load() {
        const rows = await sb('products?select=*&order=category.asc,title.asc');
        this.list = (rows || []).map(normalizeProduct);
        return this.list;
    },
    get(id) { return this.list.find(p => sameId(p.id, id)); },
    byTitle(title) { return this.list.find(p => p.title === title); },
    byCategory(cat) { return this.list.filter(p => p.category === cat); },
    async create(data) {
        const rows = await sb('products', { method: 'POST', body: data, prefer: 'return=representation' });
        if (!rows || !rows.length) throw new Error('The product was not created. Your database policies may block inserts.');
        const p = normalizeProduct(rows[0]);
        this.list.push(p); this.list.sort(byCatTitle);
        return p;
    },
    async update(id, changes) {
        const rows = await sb(`products?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', body: changes, prefer: 'return=representation' });
        if (!rows || !rows.length) throw new Error('The change was not saved. The product may have been deleted, or your database policies block edits.');
        const fresh = normalizeProduct(rows[0]), existing = this.get(id);
        if (existing) Object.assign(existing, fresh); else this.list.push(fresh);
        this.list.sort(byCatTitle);
        return this.get(id);
    },
    async remove(id) {
        const rows = await sb(`products?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE', prefer: 'return=representation' });
        if (!rows || !rows.length) throw new Error('The product was not deleted. Your database policies may block deletes.');
        this.list = this.list.filter(p => !sameId(p.id, id));
    },
    /* direction -1 = take stock (checkout), +1 = give it back (cancel). Atomic on the server. */
    async adjustStock(lines, direction) {
        const items = lines.filter(i => !i.service && i.id !== null && i.id !== undefined).map(i => ({ id: i.id, qty: i.qty }));
        if (items.length) await sb('rpc/adjust_stock_bulk', { method: 'POST', body: { items, direction } });
    }
};

/* Spec helpers */
const specText = (f, v) => (v === undefined || v === null || v === '') ? '' : String(v) + (f.unit || '');
function specChips(p, max = 4) {
    return (SPEC_FIELDS[p.category] || []).map(f => specText(f, p.specs[f.key])).filter(Boolean).slice(0, max)
        .map(t => `<span class="chip">${esc(t)}</span>`).join('');
}

/* ===== PC-builder compatibility rules (pure functions) ===== */
const specOf = p => (p && p.specs) || {};
const memTypes = cpu => String(specOf(cpu).memory_type || '').split('/').map(s => s.trim()).filter(Boolean);
const OVERHEAD_W = 50;    /* fans, drives, USB, RGB, etc. */

/* sel = { processors, motherboards, memory, 'graphics-cards', 'power-supplies' } holding product objects */
function pairChecks(sel) {
    const cpu = sel.processors, mb = sel.motherboards, ram = sel.memory, out = [];
    if (cpu && mb && specOf(cpu).socket && specOf(mb).socket) {
        const a = specOf(cpu).socket, b = specOf(mb).socket;
        out.push(a === b
            ? { level: 'ok', text: `CPU and motherboard share the ${a} socket.` }
            : { level: 'error', who: ['processors', 'motherboards'], reason: `socket ${a} vs ${b}`, text: `Socket mismatch: the CPU is ${a} but the motherboard is ${b}.` });
    }
    if (mb && ram && specOf(mb).memory_type && specOf(ram).memory_type) {
        const a = specOf(mb).memory_type, b = specOf(ram).memory_type;
        out.push(a === b
            ? { level: 'ok', text: `Memory is ${b}, which the motherboard supports.` }
            : { level: 'error', who: ['motherboards', 'memory'], reason: `${a} board vs ${b} RAM`, text: `Memory mismatch: the motherboard takes ${a} but the RAM is ${b}.` });
    }
    if (cpu && ram && memTypes(cpu).length && specOf(ram).memory_type && !memTypes(cpu).includes(specOf(ram).memory_type)) {
        out.push({ level: 'error', who: ['processors', 'memory'], reason: `CPU needs ${memTypes(cpu).join('/')}`, text: `This CPU supports ${memTypes(cpu).join('/')} memory, not ${specOf(ram).memory_type}.` });
    }
    if (cpu && mb && memTypes(cpu).length && specOf(mb).memory_type && !memTypes(cpu).includes(specOf(mb).memory_type)) {
        out.push({ level: 'error', who: ['processors', 'motherboards'], reason: `CPU needs ${memTypes(cpu).join('/')}`, text: `This CPU supports ${memTypes(cpu).join('/')} memory, but the motherboard takes ${specOf(mb).memory_type}.` });
    }
    return out;
}

/* Why would product p (in category cat) clash with what is already picked? null = fine */
function incompatibility(cat, p, sel) {
    const hypo = { ...sel, [cat]: p };
    const bad = pairChecks(hypo).find(c => c.level === 'error' && c.who.includes(cat));
    return bad ? bad.reason : null;
}

function powerEstimate(sel) {
    const parts = ['processors', 'motherboards', 'memory', 'graphics-cards'].filter(c => sel[c]);
    if (!parts.length) return 0;
    return parts.reduce((n, c) => n + (Number(specOf(sel[c]).tdp) || 0), 0) + OVERHEAD_W;
}
function recommendedPsu(sel) {
    const est = powerEstimate(sel);
    if (!est) return 0;
    const byHeadroom = Math.ceil(est * 1.3 / 50) * 50;
    return Math.max(byHeadroom, Number(specOf(sel['graphics-cards']).recommended_psu) || 0);
}

function buildChecks(sel) {
    const out = pairChecks(sel);
    const est = powerEstimate(sel), rec = recommendedPsu(sel), psu = sel['power-supplies'];
    if (psu && est && specOf(psu).wattage) {
        const w = Number(specOf(psu).wattage);
        if (w < est) out.push({ level: 'error', text: `Power supply too small: this build draws about ${est}W but the PSU supplies ${w}W.` });
        else if (w < rec) out.push({ level: 'warn', text: `Power supply works but has little headroom. We recommend ${rec}W or more.` });
        else out.push({ level: 'ok', text: `${w}W power supply covers the estimated ${est}W draw with room to spare.` });
    } else if (est) {
        out.push({ level: 'info', text: `Recommended power supply: ${rec}W or more.` });
    }
    const missing = Object.keys(CATEGORIES).filter(c => !sel[c]).map(c => CATEGORIES[c].toLowerCase());
    if (Object.keys(sel).some(c => sel[c]) && missing.length) out.push({ level: 'info', text: `Still to choose: ${missing.join(', ')}.` });
    return out;
}

/* ===== Seed data (first run only: users, orders, bookings) ===== */
const person = o => ({ phone: '', address: '', city: '', zip: '', active: true, ...o });

const SEED_USERS = [
    person({ id: 'USR-001', name: 'Edgardo Ortega', username: 'edgardo', email: 'edgardo@example.com', password: 'admin123', role: 'admin' }),
    person({ id: 'USR-002', name: 'Staff Mark', username: 'staffmark', email: 'mark.staff@iwantpc.com', password: 'staff123', role: 'staff' }),
    person({ id: 'USR-003', name: 'Alex Johnson', username: 'alexjohnson', email: 'alex.j@example.com', password: 'user123', role: 'customer', phone: '+63 912 345 6789', address: '123 Tech Street, Barangay San Isidro', city: 'Valenzuela City', zip: '1440' })
];

function seedOrder(id, status, lines, receiveDate) {
    const items = lines.map(([title, price, qty]) => ({ id: null, title, price, qty }));
    return { id, email: 'alex.j@example.com', customer: 'Alex Johnson', items, total: totals(items).total, status, payment: 'cod', note: '', placed: '2026-10-10', receiveDate, proof: '' };
}
const SEED_ORDERS = [
    seedOrder('ORD-2026-9041', 'toreceive', [['NVIDIA RTX 4070 OC Edition', 649, 1]], '2026-10-25'),
    seedOrder('ORD-2026-9042', 'toship', [['Corsair Vengeance RGB 32GB DDR5', 119.99, 1]], '2026-10-26'),
    seedOrder('ORD-2026-8810', 'completed', [['AMD Ryzen 7 7800X3D', 399, 1]], '2026-10-05'),
    seedOrder('ORD-2026-9100', 'pending', [['Corsair RM850x Shift 850W PSU', 139.99, 1]], '')
];
const SEED_BOOKINGS = [
    { id: 'SRV-5012', customer: 'Michael Tan', email: '', device: 'AMD Ryzen 5 Processor', type: 'Warranty Claim (Bent Pins)', details: '', status: 'Under Review' }
];

[[KEY.users, SEED_USERS], [KEY.orders, SEED_ORDERS], [KEY.bookings, SEED_BOOKINGS], [KEY.reports, 0]]
    .forEach(([key, value]) => { if (localStorage.getItem(key) === null) write(key, value); });
localStorage.removeItem('iwp_products');   /* products moved to Supabase */

/* ===== Session & access control ===== */
const homeFor = role => ({ admin: 'admin.html', staff: 'staff.html' }[role] || 'home.html');
function currentUser() {
    const s = read(KEY.session, null);
    return (s && read(KEY.users, []).find(u => u.email === s.email && u.active)) || null;
}
function guard(roles) {
    const user = currentUser();
    if (!user || (roles && !roles.includes(user.role))) { location.replace(user ? homeFor(user.role) : 'login.html'); return null; }
    return user;
}
function formMessage(text, ok = false) {
    const el = $('#formMsg');
    el.textContent = text;
    el.classList.toggle('ok', ok);
}

/* ===== Cart ===== */
const getCart = () => read(KEY.cart, []);
const saveCart = cart => write(KEY.cart, cart);
function addToCart(id, qty = 1) {
    const product = Products.get(id);
    const cart = getCart(), line = cart.find(i => sameId(i.id, id));
    if (!product || (line ? line.qty : 0) + qty > product.stock) { toast('Not enough stock for this item.', 'error'); return null; }
    if (line) line.qty += qty; else cart.push({ id: product.id, title: product.title, price: product.price, qty });
    saveCart(cart);
    return product;
}

/* Navbar + cart drawer + account menu: shared by the home page and the PC builder */
function initShell(user) {
    const drawer = $('#cartDrawer'), overlay = $('#cartOverlay'), dropdown = $('#userDropdown');
    $('#userName').textContent = user.name;
    $('#userEmail').textContent = user.email;

    const renderCart = () => {
        const cart = getCart();
        $('#cartCount').textContent = cart.reduce((n, i) => n + i.qty, 0);
        $('#cartItems').innerHTML = cart.length ? cart.map(i => {
            const p = i.service ? null : (Products.get(i.id) || Products.byTitle(i.title));
            return `
            <div class="cart-item" data-id="${esc(i.id)}">
                <img class="cart-item-img" src="${productImg(p)}" alt="">
                <div class="cart-item-details">
                    <div class="cart-item-title">${esc(i.title)}</div>
                    <div class="cart-item-price">${money(i.price * i.qty)}</div>
                    ${i.service ? '<div class="stock">Service</div>' : `<div class="qty-controls">
                        <button class="qty-btn" data-qty="-1" aria-label="Decrease quantity">-</button>
                        <span>${i.qty}</span>
                        <button class="qty-btn" data-qty="1" aria-label="Increase quantity">+</button>
                    </div>`}
                </div>
                <button class="remove-item-btn" data-remove aria-label="Remove item"><i class="fa-solid fa-trash"></i></button>
            </div>`;
        }).join('') : '<p class="cart-empty">Your cart is empty.</p>';
        const t = totals(cart);
        $('#cartSubtotal').textContent = money(t.subtotal);
        $('#cartTax').textContent = money(t.tax);
        $('#cartTotal').textContent = money(t.subtotal + t.tax);
    };
    const toggleCart = open => { drawer.classList.toggle('open', open); overlay.classList.toggle('show', open); };

    $('#cartItems').addEventListener('click', e => {
        const row = e.target.closest('.cart-item');
        if (!row) return;
        const id = row.dataset.id, cart = getCart(), line = cart.find(i => sameId(i.id, id));
        if (!line) return;
        const step = e.target.closest('[data-qty]');
        if (e.target.closest('[data-remove]')) saveCart(cart.filter(i => i !== line));
        else if (step && +step.dataset.qty > 0) { if (!line.service) addToCart(id); }
        else if (step) { line.qty--; saveCart(cart.filter(i => i.qty > 0)); }
        renderCart();
    });
    $('#checkoutBtn').addEventListener('click', () => {
        if (!getCart().length) return toast('Your cart is empty.', 'error');
        location.href = 'checksumm.html';
    });
    $('#openCartBtn').addEventListener('click', () => toggleCart(true));
    $('#closeCartBtn').addEventListener('click', () => toggleCart(false));
    overlay.addEventListener('click', () => toggleCart(false));
    document.addEventListener('keydown', e => { if (e.key === 'Escape') { toggleCart(false); dropdown.classList.remove('show'); } });
    $('#userMenuBtn').addEventListener('click', e => { e.stopPropagation(); dropdown.classList.toggle('show'); });
    document.addEventListener('click', () => dropdown.classList.remove('show'));

    renderCart();
    return { renderCart, toggleCart };
}

const errorCard = (message, retry = true) =>
    `<div class="card empty-state"><i class="fa-solid fa-triangle-exclamation"></i><p>${esc(message)}</p>${retry ? '<button class="btn btn-primary" data-retry>Try again</button>' : ''}</div>`;

/* ===== Shared inventory manager (staff + admin) ===== */
function setupInventory(tbody, { canDelete = false, addButton = null } = {}) {
    const modal = $('#productModal'), form = $('#productForm'), specBox = $('#specFields');
    const filterCat = $('#inventoryCategory'), filterText = $('#inventorySearch');
    const preview = $('#imagePreview'), imageUrl = $('#imageUrl'), imageFile = $('#imageFile');
    const catSelect = form.elements.category, saveBtn = $('#saveProductBtn');
    const catOptions = Object.entries(CATEGORIES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
    catSelect.innerHTML = catOptions;
    filterCat.innerHTML = '<option value="all">All categories</option>' + catOptions;

    let editing = null, pendingBlob = null, objectUrl = null;
    const COLS = 7;

    /* --- table --- */
    const rowHtml = p => `
        <tr data-id="${esc(p.id)}">
            <td><img class="thumb" src="${productImg(p)}" alt="${esc(p.title)}" loading="lazy"></td>
            <td><strong>${esc(p.title)}</strong><div class="sub">${esc(p.description)}</div></td>
            <td>${esc(CATEGORIES[p.category] || p.category)}</td>
            <td><div class="chips">${specChips(p) || '<span class="stock">No specs yet</span>'}</div></td>
            <td><input class="edit-input narrow" type="number" min="0" step="1" data-f="stock" value="${p.stock}" aria-label="Stock for ${esc(p.title)}"></td>
            <td><input class="edit-input narrow" type="number" min="0" step="0.01" data-f="price" value="${p.price.toFixed(2)}" aria-label="Price for ${esc(p.title)}"></td>
            <td class="actions">
                <button class="btn btn-sm btn-soft" data-edit><i class="fa-solid fa-pen"></i> Edit</button>
                ${canDelete ? '<button class="btn btn-sm btn-outline danger" data-delete aria-label="Delete product"><i class="fa-solid fa-trash"></i></button>' : ''}
            </td>
        </tr>`;
    const matches = p => (filterCat.value === 'all' || p.category === filterCat.value)
        && `${p.title} ${p.description} ${Object.values(p.specs).join(' ')}`.toLowerCase().includes(filterText.value.trim().toLowerCase());
    const render = () => {
        const list = Products.list.filter(matches);
        tbody.innerHTML = list.length ? list.map(rowHtml).join('')
            : `<tr><td colspan="${COLS}" class="table-empty">${Products.list.length ? 'No products match your filter.' : 'No products yet. Use the Add component button to create one.'}</td></tr>`;
    };
    const changed = () => document.dispatchEvent(new CustomEvent('inventory:changed'));
    const load = async () => {
        tbody.innerHTML = `<tr><td colspan="${COLS}" class="table-empty"><i class="fa-solid fa-spinner fa-spin"></i> Loading products...</td></tr>`;
        try { await Products.load(); render(); }
        catch (err) { tbody.innerHTML = `<tr><td colspan="${COLS}" class="table-empty">${esc(err.message)} <button class="btn btn-sm btn-soft" data-retry>Retry</button></td></tr>`; }
        changed();
    };

    /* --- dynamic spec fields --- */
    const specInput = (cat, f, value) => {
        const id = 'spec-' + f.key, req = f.required ? ' required' : '', val = value ?? '';
        let control;
        if (f.type === 'select') {
            const opts = (!val || f.options.includes(String(val))) ? f.options : [...f.options, String(val)];
            control = `<select id="${id}" data-spec="${f.key}"${req}><option value="">Select...</option>${opts.map(o => `<option${String(o) === String(val) ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
        } else if (f.type === 'combo') {
            control = `<input id="${id}" data-spec="${f.key}" list="dl-${cat}-${f.key}" value="${esc(val)}" autocomplete="off"${req}><datalist id="dl-${cat}-${f.key}">${f.options.map(o => `<option value="${esc(o)}">`).join('')}</datalist>`;
        } else {
            control = `<input id="${id}" data-spec="${f.key}" type="number" min="0" step="${f.step || 1}" value="${esc(val)}"${req}>`;
        }
        return `<label class="field"><span>${esc(f.label)}${f.required ? ' *' : ''}</span>${control}</label>`;
    };
    const renderSpecs = (cat, values = {}) => {
        $('#specTitle').textContent = 'Technical specifications: ' + (CATEGORIES[cat] || '');
        specBox.innerHTML = (SPEC_FIELDS[cat] || []).map(f => specInput(cat, f, values[f.key])).join('');
    };
    const collectSpecs = () => {
        const out = {};
        $$('[data-spec]', specBox).forEach(el => {
            const key = el.dataset.spec, f = (SPEC_FIELDS[catSelect.value] || []).find(x => x.key === key), v = el.value.trim();
            if (!v) return;
            out[key] = f.type === 'number' ? Number(v) : (key === 'socket' ? v.toUpperCase() : v);
        });
        return out;
    };

    /* --- image field --- */
    const setPreview = src => { preview.src = src || placeholder(); };
    preview.addEventListener('error', () => { preview.src = placeholder(); });
    imageFile.addEventListener('change', async () => {
        const file = imageFile.files[0];
        if (!file) return;
        try {
            pendingBlob = await resizeToBlob(file);
            if (objectUrl) URL.revokeObjectURL(objectUrl);
            objectUrl = URL.createObjectURL(pendingBlob);
            imageUrl.value = '';
            setPreview(objectUrl);
        } catch (err) { pendingBlob = null; imageFile.value = ''; toast(esc(err.message), 'error'); }
    });
    imageUrl.addEventListener('input', () => { pendingBlob = null; imageFile.value = ''; });
    imageUrl.addEventListener('change', () => setPreview(imageUrl.value.trim()));   /* preview once, not per keystroke */
    $('#imageClear').addEventListener('click', () => { pendingBlob = null; imageFile.value = ''; imageUrl.value = ''; setPreview(''); });

    /* --- modal --- */
    const openModal = p => {
        editing = p || null; pendingBlob = null;
        form.reset(); imageFile.value = '';
        $('#modalTitle').textContent = p ? 'Edit component' : 'Add component';
        form.elements.title.value = p?.title ?? '';
        catSelect.value = p?.category || 'processors';
        form.elements.price.value = p ? p.price.toFixed(2) : '';
        form.elements.stock.value = p ? p.stock : 0;
        form.elements.description.value = p?.description ?? '';
        imageUrl.value = p?.image || '';
        setPreview(p?.image);
        renderSpecs(catSelect.value, p?.specs || {});
        modal.showModal();
    };
    catSelect.addEventListener('change', () => { const carry = collectSpecs(); renderSpecs(catSelect.value, carry); });
    $$('[data-close]', modal).forEach(b => b.addEventListener('click', () => modal.close()));
    modal.addEventListener('click', e => { if (e.target === modal) modal.close(); });

    form.addEventListener('submit', async e => {
        e.preventDefault();
        const title = form.elements.title.value.trim();
        const price = Math.round((parseFloat(form.elements.price.value) || 0) * 100) / 100;
        const stock = Math.max(0, parseInt(form.elements.stock.value, 10) || 0);
        if (!title) return toast('Please enter a product name.', 'error');
        if (price < 0) return toast('Price cannot be negative.', 'error');
        saveBtn.disabled = true;
        const label = saveBtn.innerHTML;
        saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';
        try {
            let image = imageUrl.value.trim() || null;
            if (pendingBlob) image = await uploadProductImage(pendingBlob, title);
            const category = catSelect.value;
            const specs = (editing && editing.category === category) ? { ...editing.specs } : {};
            (SPEC_FIELDS[category] || []).forEach(f => delete specs[f.key]);
            Object.assign(specs, collectSpecs());
            const payload = { title, category, description: form.elements.description.value.trim(), price, stock, image, specs };
            if (editing) await Products.update(editing.id, payload); else await Products.create(payload);
            toast(editing ? 'Component updated.' : 'Component added.');
            modal.close(); render(); changed();
        } catch (err) { toast(esc(err.message), 'error'); }
        finally { saveBtn.disabled = false; saveBtn.innerHTML = label; }
    });

    /* --- table events --- */
    tbody.addEventListener('click', async e => {
        if (e.target.closest('[data-retry]')) return load();
        const row = e.target.closest('tr[data-id]');
        if (!row) return;
        const p = Products.get(row.dataset.id);
        if (!p) return;
        if (e.target.closest('[data-edit]')) openModal(p);
        if (e.target.closest('[data-delete]') && confirm(`Delete "${p.title}"? This cannot be undone.`)) {
            try { await Products.remove(p.id); render(); changed(); toast('Product deleted.'); }
            catch (err) { toast(esc(err.message), 'error'); }
        }
    });
    tbody.addEventListener('change', async e => {
        const input = e.target.closest('[data-f]');
        if (!input) return;
        const p = Products.get(input.closest('tr').dataset.id), field = input.dataset.f;
        if (!p) return;
        const value = field === 'stock' ? Math.max(0, parseInt(input.value, 10) || 0) : Math.max(0, Math.round((parseFloat(input.value) || 0) * 100) / 100);
        try {
            await Products.update(p.id, { [field]: value });
            input.value = field === 'price' ? value.toFixed(2) : value;
            toast(`${field === 'price' ? 'Price' : 'Stock'} updated.`);
            changed();
        } catch (err) { input.value = field === 'price' ? p.price.toFixed(2) : p.stock; toast(esc(err.message), 'error'); }
    });
    filterCat.addEventListener('change', render);
    filterText.addEventListener('input', render);
    if (addButton) addButton.addEventListener('click', () => openModal(null));

    load();
}

const paidOrders = () => read(KEY.orders, []).filter(o => o.status !== 'pending');
const revenue = () => paidOrders().reduce((sum, o) => sum + o.total, 0);

/* ===== Page initializers ===== */
const pages = {};

pages.login = () => {
    const existing = currentUser();
    if (existing) { location.replace(homeFor(existing.role)); return; }
    $('#loginForm').addEventListener('submit', e => {
        e.preventDefault();
        const email = $('#email').value.trim().toLowerCase(), password = $('#password').value;
        const user = read(KEY.users, []).find(u => u.email.toLowerCase() === email && u.password === password);
        if (!user) return formMessage('Incorrect email or password.');
        if (!user.active) return formMessage('This account is suspended. Contact an administrator.');
        write(KEY.session, { email: user.email });
        location.href = homeFor(user.role);
    });
};

pages.signup = () => {
    $('#signupForm').addEventListener('submit', e => {
        e.preventDefault();
        const users = read(KEY.users, []);
        const email = $('#email').value.trim().toLowerCase(), password = $('#password').value;
        if (password.length < 6) return formMessage('Password must be at least 6 characters.');
        if (password !== $('#confirm-password').value) return formMessage('Passwords do not match.');
        if (users.some(u => u.email.toLowerCase() === email)) return formMessage('An account with this email already exists.');
        const name = $('#fullname').value.trim();
        users.push(person({ id: 'USR-' + String(users.length + 1).padStart(3, '0'), name, username: email.split('@')[0], email, password, role: 'customer' }));
        write(KEY.users, users);
        formMessage('Account created. Redirecting to sign in...', true);
        setTimeout(() => { location.href = 'login.html'; }, 1000);
    });
};

pages.home = async () => {
    const user = guard();
    if (!user) return;
    let category = 'all';
    const grid = $('#productGrid'), search = $('#searchInput');
    const shell = initShell(user);

    const renderProducts = () => {
        const q = search.value.trim().toLowerCase();
        const list = Products.list.filter(p => (category === 'all' || p.category === category)
            && `${p.title} ${p.description} ${Object.values(p.specs).join(' ')}`.toLowerCase().includes(q));
        grid.innerHTML = list.length ? list.map(p => `
            <article class="product-card" data-id="${esc(p.id)}">
                <div class="product-image"><img src="${productImg(p)}" alt="${esc(p.title)}" loading="lazy"></div>
                <div class="product-info">
                    <h3 class="product-title">${esc(p.title)}</h3>
                    <div class="chips">${specChips(p, 3)}</div>
                    <p class="product-description">${esc(p.description)}</p>
                </div>
                <div class="product-bottom">
                    <div class="product-meta">
                        <span class="product-price">${money(p.price)}</span>
                        <span class="stock${p.stock <= 5 ? ' low' : ''}">${p.stock > 0 ? p.stock + ' in stock' : 'Out of stock'}</span>
                    </div>
                    <div class="card-actions">
                        <button class="btn btn-soft" data-add ${p.stock < 1 ? 'disabled' : ''}><i class="fa-solid fa-cart-plus"></i> Add</button>
                        <button class="btn btn-ok" data-buy ${p.stock < 1 ? 'disabled' : ''}>Buy Now</button>
                    </div>
                </div>
            </article>`).join('') : '<div class="empty-state"><i class="fa-solid fa-magnifying-glass"></i><p>No products found matching your search.</p></div>';
    };

    const load = async () => {
        grid.innerHTML = '<div class="empty-state"><i class="fa-solid fa-spinner fa-spin"></i><p>Loading products...</p></div>';
        try { await Products.load(); renderProducts(); shell.renderCart(); }
        catch (err) { grid.innerHTML = errorCard(err.message); }
    };

    grid.addEventListener('click', e => {
        if (e.target.closest('[data-retry]')) return load();
        const card = e.target.closest('.product-card');
        if (!card) return;
        const id = card.dataset.id;
        if (e.target.closest('[data-add]')) {
            const p = addToCart(id);
            if (p) { shell.renderCart(); toast(`Added <strong>${esc(p.title)}</strong> to cart!`); }
        }
        if (e.target.closest('[data-buy]') && addToCart(id)) { shell.renderCart(); shell.toggleCart(true); }
    });

    search.addEventListener('input', renderProducts);
    $('#categoryPills').addEventListener('click', e => {
        const pill = e.target.closest('.pill');
        if (!pill) return;
        $$('.pill').forEach(p => p.classList.toggle('active', p === pill));
        category = pill.dataset.category;
        renderProducts();
    });

    /* arriving from the builder's search box or its "Book Consultation" button */
    const q0 = new URLSearchParams(location.search).get('q');
    if (q0) search.value = q0;
    $$('[data-prefill]').forEach(btn => btn.addEventListener('click', () => { $('#bookingType').value = btn.dataset.prefill; }));
    const pre = read(KEY.prefill, null);
    if (pre) {
        $('#bookingType').value = pre.type; $('#bookingDevice').value = pre.device; $('#bookingDetails').value = pre.details;
        localStorage.removeItem(KEY.prefill);
    }
    $('#bookingForm').addEventListener('submit', e => {
        e.preventDefault();
        const bookings = read(KEY.bookings, []);
        bookings.push({ id: uid('SRV-'), customer: user.name, email: user.email, device: $('#bookingDevice').value.trim(), type: $('#bookingType').value, details: $('#bookingDetails').value.trim(), status: 'Under Review' });
        write(KEY.bookings, bookings);
        e.target.reset();
        toast('Booking submitted. Our staff will review it shortly.');
    });

    await load();
};

pages['pc-builder'] = async () => {
    const user = guard();
    if (!user) return;
    const shell = initShell(user);
    $('#searchInput').addEventListener('keydown', e => {
        if (e.key === 'Enter') location.href = 'home.html?q=' + encodeURIComponent(e.target.value.trim()) + '#products';
    });

    const PARTS = [
        { cat: 'processors', label: 'Processor (CPU)', icon: 'fa-microchip', prompt: 'Select a processor' },
        { cat: 'motherboards', label: 'Motherboard', icon: 'fa-server', prompt: 'Select a motherboard' },
        { cat: 'memory', label: 'Memory (RAM)', icon: 'fa-memory', prompt: 'Select memory' },
        { cat: 'graphics-cards', label: 'Graphics Card (GPU)', icon: 'fa-desktop', prompt: 'Select a graphics card' },
        { cat: 'power-supplies', label: 'Power Supply (PSU)', icon: 'fa-plug', prompt: 'Select a power supply' }
    ];
    const groups = $('#builderGroups');
    let ids = read(KEY.build, {});          /* category -> product id */

    const load = async () => {
        groups.innerHTML = '<div class="empty-state"><i class="fa-solid fa-spinner fa-spin"></i><p>Loading components...</p></div>';
        try { await Products.load(); } catch (err) { groups.innerHTML = errorCard(err.message); return false; }
        shell.renderCart();
        groups.innerHTML = PARTS.map(({ cat, label, icon }) => `
            <div class="component-group" data-cat="${cat}">
                <div class="component-header">
                    <span class="component-title"><i class="fa-solid ${icon}"></i> ${label}</span>
                    <span class="stock" data-count></span>
                </div>
                <label class="field" style="margin-bottom:0"><span class="sr-only">${label}</span><select data-select aria-label="${label}"></select></label>
                <div class="selected-part" data-detail></div>
            </div>`).join('');
        return true;
    };

    const selection = () => Object.fromEntries(PARTS.map(({ cat }) => [cat, ids[cat] ? Products.get(ids[cat]) : undefined]));

    const refresh = () => {
        const sel = selection();
        PARTS.forEach(({ cat }) => { if (ids[cat] && !sel[cat]) delete ids[cat]; });
        write(KEY.build, ids);

        PARTS.forEach(({ cat, prompt }) => {
            const group = $(`[data-cat="${cat}"]`, groups), select = $('[data-select]', group);
            const list = Products.byCategory(cat).sort((a, b) => a.price - b.price);
            $('[data-count]', group).textContent = `${list.length} available`;
            select.innerHTML = `<option value="">-- ${prompt} --</option>` + list.map(p => {
                const why = sel[cat]?.id === p.id ? null : incompatibility(cat, p, sel);
                const out = p.stock < 1 && sel[cat]?.id !== p.id;
                const extra = specText({ unit: 'W' }, specOf(p).tdp ?? specOf(p).wattage);
                const tag = out ? ' (out of stock)' : why ? ` (incompatible: ${why})` : '';
                return `<option value="${esc(p.id)}"${sel[cat]?.id === p.id ? ' selected' : ''}${(out || why) ? ' disabled' : ''}>${esc(p.title)} | ${money(p.price)}${extra ? ' | ' + extra : ''}${tag}</option>`;
            }).join('');
            const p = sel[cat], detail = $('[data-detail]', group);
            detail.classList.toggle('active', !!p);
            detail.innerHTML = p
                ? `<img class="thumb" src="${productImg(p)}" alt=""><div class="part-info"><div class="part-name">${esc(p.title)}</div><div class="chips">${specChips(p, 6)}</div></div><div class="part-price">${money(p.price)}</div>`
                : '<span class="hint" style="margin:0">Nothing selected yet.</span>';
        });

        /* summary */
        const chosen = PARTS.filter(({ cat }) => sel[cat]).map(({ cat }) => ({ cat, p: sel[cat] }));
        const assembly = $('#assemblyToggle').checked;
        const subtotal = chosen.reduce((n, c) => n + c.p.price, 0);
        $('#selectedPartsList').innerHTML = chosen.length
            ? chosen.map(({ cat, p }) => `<div class="summary-row"><span class="part-line">${esc(p.title)}</span><span>${money(p.price)} <button class="remove-item-btn" data-clear="${cat}" aria-label="Remove ${esc(p.title)}"><i class="fa-solid fa-xmark"></i></button></span></div>`).join('')
            : '<p class="hint">No components selected yet.</p>';
        $('#buildSubtotal').textContent = money(subtotal);
        $('#assemblyRow').hidden = !assembly;
        $('#buildTotal').textContent = money(subtotal + (assembly && chosen.length ? ASSEMBLY_FEE : 0));
        $('#assemblyRow').querySelector('span:last-child').textContent = money(ASSEMBLY_FEE);

        /* power meter */
        const est = powerEstimate(sel), rec = recommendedPsu(sel), psuW = Number(specOf(sel['power-supplies']).wattage) || 0;
        $('#totalWatts').textContent = est ? `${est} W` : '0 W';
        $('#recWatts').textContent = rec ? `${rec} W+` : '--';
        const pct = est && psuW ? Math.min(100, Math.round(est / psuW * 100)) : 0;
        const fill = $('#meterFill');
        fill.style.width = pct + '%';
        fill.className = 'meter-fill' + (psuW && est > psuW ? ' bad' : (psuW && psuW < rec ? ' warn' : ''));
        $('#meterLabel').textContent = psuW && est ? `${pct}% of the ${psuW}W power supply` : 'Pick a power supply to see headroom';

        /* compatibility */
        const checks = buildChecks(sel);
        const icon = { ok: 'fa-circle-check', warn: 'fa-triangle-exclamation', error: 'fa-circle-xmark', info: 'fa-circle-info' };
        $('#compatList').innerHTML = checks.length
            ? checks.map(c => `<li class="compat ${c.level}"><i class="fa-solid ${icon[c.level]}"></i><span>${esc(c.text)}</span></li>`).join('')
            : '<li class="compat info"><i class="fa-solid fa-circle-info"></i><span>Pick parts and we will check that they fit together.</span></li>';
        return { sel, chosen, checks };
    };

    if (!(await load())) {
        groups.addEventListener('click', e => { if (e.target.closest('[data-retry]')) location.reload(); });
        return;
    }
    {
        groups.addEventListener('change', e => {
            const select = e.target.closest('[data-select]');
            if (!select) return;
            const cat = select.closest('[data-cat]').dataset.cat;
            if (select.value) ids[cat] = select.value; else delete ids[cat];
            refresh();
        });
        $('#selectedPartsList').addEventListener('click', e => {
            const btn = e.target.closest('[data-clear]');
            if (btn) { delete ids[btn.dataset.clear]; refresh(); }
        });
        $('#assemblyToggle').addEventListener('change', refresh);
        $('#resetBuildBtn').addEventListener('click', () => { ids = {}; refresh(); toast('Build cleared.'); });

        $('#addBuildBtn').addEventListener('click', () => {
            const { chosen, checks } = refresh();
            if (!chosen.length) return toast('Select at least one component first.', 'error');
            if (checks.some(c => c.level === 'error')) return toast('Fix the compatibility errors before adding this build to your cart.', 'error');
            let added = 0;
            chosen.forEach(({ p }) => { if (addToCart(p.id)) added++; });
            if (!added) return;
            if ($('#assemblyToggle').checked) {
                const cart = getCart();
                if (!cart.some(i => i.id === ASSEMBLY_ID)) { cart.push({ id: ASSEMBLY_ID, title: 'PC Assembly & Testing Service', price: ASSEMBLY_FEE, qty: 1, service: true }); saveCart(cart); }
            }
            const notes = $('#buildNotes').value.trim();
            if (notes) localStorage.setItem(KEY.buildNote, 'Custom PC build request: ' + notes);
            shell.renderCart(); shell.toggleCart(true);
            toast('Build added to your cart.');
        });

        $('#bookConsultBtn').addEventListener('click', () => {
            const { chosen } = refresh();
            write(KEY.prefill, {
                type: 'PC Build Consultation',
                device: chosen.length ? chosen.map(c => c.p.title).join(' + ') : 'Custom PC build',
                details: $('#buildNotes').value.trim() || 'I would like help finalizing this build.'
            });
            location.href = 'home.html#services-booking';
        });
        refresh();
    }
};

pages.checkout = async () => {
    const user = guard();
    if (!user) return;
    const body = $('#checkoutBody');
    const empty = () => { body.innerHTML = '<div class="card empty-state"><i class="fa-solid fa-cart-shopping"></i><p>Your cart is empty.</p><a href="home.html" class="btn btn-primary">Browse products</a></div>'; };
    let cart = getCart();
    if (!cart.length) return empty();

    try { await Products.load(); }
    catch (err) { body.innerHTML = errorCard(err.message); body.addEventListener('click', e => { if (e.target.closest('[data-retry]')) location.reload(); }); return; }

    /* re-price against the live catalog and drop anything that is gone or sold out */
    const dropped = [];
    cart = cart.filter(i => {
        if (i.service) return true;
        const p = Products.get(i.id);
        if (!p || p.stock < 1) { dropped.push(i.title); return false; }
        i.price = p.price; i.title = p.title; i.qty = Math.min(i.qty, p.stock);
        return true;
    });
    saveCart(cart);
    if (dropped.length) toast(`No longer available and removed: ${esc(dropped.join(', '))}`, 'error');
    if (!cart.some(i => !i.service)) { saveCart([]); return empty(); }

    const t = totals(cart);
    $('#summaryRows').innerHTML = cart.map(i => `<div class="summary-row"><span>${esc(i.title)} (x${i.qty})</span><span>${money(i.price * i.qty)}</span></div>`).join('') +
        `<div class="summary-row"><span>Subtotal</span><span>${money(t.subtotal)}</span></div>
         <div class="summary-row"><span>Estimated Tax (${TAX_RATE * 100}%)</span><span>${money(t.tax)}</span></div>
         <div class="summary-row"><span>Shipping Fee</span><span>${money(t.shipping)}</span></div>`;
    $('#sumTotal').textContent = money(t.total);
    const address = [user.address, user.city, user.zip].filter(Boolean).join(', ');
    $('#shipTo').innerHTML = address ? `Ship to: <strong>${esc(address)}</strong>. <a href="accountsetting.html">Change</a>` : 'No shipping address yet. <a href="accountsetting.html">Add one in Account Settings</a>.';
    const buildNote = localStorage.getItem(KEY.buildNote);
    if (buildNote) $('#checkoutForm').elements.note.value = buildNote;

    $('#checkoutForm').addEventListener('submit', async e => {
        e.preventDefault();
        const btn = $('button[type="submit"]', e.target), label = btn.innerHTML;
        btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Placing order...';
        try {
            await Products.adjustStock(cart, -1);      /* atomic: fails with a clear message if anything is short */
            const form = new FormData(e.target), payment = form.get('payment');
            const orders = read(KEY.orders, []);
            orders.unshift({
                id: uid('ORD-2026-'), email: user.email, customer: user.name,
                items: cart.map(({ id, title, price, qty, service }) => ({ id, title, price, qty, ...(service ? { service: true } : {}) })),
                total: t.total, status: payment === 'cod' ? 'toship' : 'pending', payment, note: form.get('note').trim(),
                placed: new Date().toISOString().slice(0, 10), receiveDate: '', proof: ''
            });
            write(KEY.orders, orders);
            saveCart([]);
            localStorage.removeItem(KEY.buildNote);
            toast('Order placed successfully!');
            setTimeout(() => { location.href = 'myorders.html'; }, 900);
        } catch (err) {
            toast(esc(err.message), 'error');
            btn.disabled = false; btn.innerHTML = label;
        }
    });
};

pages.orders = async () => {
    const user = guard();
    if (!user) return;
    const list = $('#ordersList');
    let tab = 'all';
    const actions = {
        pending:   '<button class="btn btn-outline danger" data-act="cancel"><i class="fa-solid fa-xmark"></i> Cancel Order</button><button class="btn btn-ok" data-act="pay"><i class="fa-solid fa-credit-card"></i> Pay Now</button>',
        toship:    '<button class="btn btn-outline" data-act="contact"><i class="fa-solid fa-headset"></i> Contact Seller</button>',
        toreceive: '<button class="btn btn-outline" data-act="track"><i class="fa-solid fa-location-dot"></i> Track Parcel</button><button class="btn btn-primary" data-act="received"><i class="fa-solid fa-box-open"></i> Order Received</button>',
        completed: '<button class="btn btn-outline" data-act="review"><i class="fa-solid fa-star"></i> Write Review</button><button class="btn btn-primary" data-act="again"><i class="fa-solid fa-rotate-right"></i> Buy Again</button>'
    };
    const render = () => {
        const mine = read(KEY.orders, []).filter(o => o.email === user.email && (tab === 'all' || o.status === tab));
        list.innerHTML = mine.length ? mine.map(o => `
            <div class="order-card" data-id="${esc(o.id)}">
                <div class="order-header">
                    <span>Order ID: <span class="order-id">#${esc(o.id)}</span></span>
                    <span class="status ${o.status}"><i class="fa-solid ${ORDER_STATUS[o.status].icon}"></i> ${ORDER_STATUS[o.status].label}</span>
                </div>
                ${o.items.map(i => `
                <div class="order-item">
                    <img class="item-img" src="${productImg(Products.byTitle(i.title))}" alt="">
                    <div class="item-info"><div class="item-name">${esc(i.title)}</div><div class="item-qty">Quantity: x${i.qty}</div></div>
                    <div class="item-price">${money(i.price * i.qty)}</div>
                </div>`).join('')}
                <div class="order-footer">
                    <div class="order-total">Total Amount: <strong>${money(o.total)}</strong></div>
                    <div class="order-actions">${actions[o.status]}</div>
                </div>
            </div>`).join('') : '<div class="card empty-state"><i class="fa-solid fa-box-open"></i><p>No orders in this tab yet.</p></div>';
    };

    $('#orderTabs').addEventListener('click', e => {
        const btn = e.target.closest('.tab-btn');
        if (!btn) return;
        $$('.tab-btn').forEach(b => b.classList.toggle('active', b === btn));
        tab = btn.dataset.tab;
        render();
    });

    list.addEventListener('click', async e => {
        const btn = e.target.closest('[data-act]');
        if (!btn) return;
        const orders = read(KEY.orders, []), order = orders.find(o => o.id === btn.closest('.order-card').dataset.id);
        if (!order) return;
        const save = message => { write(KEY.orders, orders); render(); toast(message); };
        switch (btn.dataset.act) {
            case 'pay': order.status = 'toship'; save('Payment received. Your order is ready to ship.'); break;
            case 'received': order.status = 'completed'; save('Thanks! Order marked as received.'); break;
            case 'cancel':
                if (!confirm('Cancel this order?')) break;
                try {
                    /* put stock back; match by title because seeded orders carry no product id */
                    await Products.load();
                    const back = order.items.map(i => ({ ...i, id: Products.byTitle(i.title)?.id ?? null }));
                    await Products.adjustStock(back, +1);
                } catch (err) { toast(esc(err.message), 'error'); break; }
                write(KEY.orders, orders.filter(o => o !== order)); render(); toast('Order cancelled.');
                break;
            case 'again': {
                let added = 0;
                order.items.forEach(i => {
                    const p = Products.byTitle(i.title);
                    if (p && !i.service && addToCart(p.id, i.qty)) added++;
                });
                if (!added) { toast('Those items are no longer available.', 'error'); break; }
                toast('Items added to your cart.');
                setTimeout(() => { location.href = 'home.html'; }, 800);
                break;
            }
            case 'track': toast('Tracking: your parcel is on its way.'); break;
            case 'contact': toast('The seller has been notified.'); break;
            case 'review': toast('Reviews are coming soon.'); break;
        }
    });
    render();
    try { await Products.load(); render(); } catch { /* images fall back to the placeholder */ }
};

pages.settings = () => {
    const user = guard();
    if (!user) return;
    const users = read(KEY.users, []);
    const fill = form => $$('[name]', form).forEach(input => { if (input.name in user && input.type !== 'password') input.value = user[input.name]; });
    const persist = (changes, message) => { Object.assign(user, changes); write(KEY.users, users.map(u => u.id === user.id ? user : u)); write(KEY.session, { email: user.email }); toast(message); };
    const data = form => Object.fromEntries(new FormData(form));
    $$('#profileForm, #addressForm').forEach(fill);
    $('#profileForm').addEventListener('submit', e => {
        e.preventDefault();
        const d = data(e.target);
        if (users.some(u => u.id !== user.id && u.email.toLowerCase() === d.email.toLowerCase())) return toast('That email is already used by another account.', 'error');
        persist(d, 'Profile settings updated successfully!');
    });
    $('#addressForm').addEventListener('submit', e => { e.preventDefault(); persist(data(e.target), 'Shipping address updated successfully!'); });
    $('#passwordForm').addEventListener('submit', e => {
        e.preventDefault();
        const d = data(e.target);
        if (d.current !== user.password) return toast('Current password is incorrect.', 'error');
        if (d.next.length < 6) return toast('New password must be at least 6 characters.', 'error');
        if (d.next !== d.confirm) return toast('New passwords do not match.', 'error');
        persist({ password: d.next }, 'Password changed successfully!');
        e.target.reset();
    });
};

pages.staff = () => {
    if (!guard(['staff', 'admin'])) return;
    const tbody = $('#queueBody'), proofInput = $('#proofInput');
    let pendingId = null;
    const saveOrders = orders => { write(KEY.orders, orders); renderQueue(); };

    const renderMetrics = () => {
        $('#mItems').textContent = Products.list.reduce((n, p) => n + p.stock, 0);
        $('#mSale').textContent = money(revenue());
        $('#mBookings').textContent = read(KEY.bookings, []).length;
        $('#mReports').textContent = read(KEY.reports, 0);
    };
    function renderQueue() {
        const orders = read(KEY.orders, []);
        tbody.innerHTML = orders.map(o => {
            const done = o.status === 'completed';
            const action = done ? `<span class="btn btn-sm btn-ok static"><i class="fa-solid fa-check"></i> Completed</span><span class="proof"><i class="fa-solid fa-image"></i> ${esc(o.proof || 'Proof uploaded')}</span>`
                : o.status === 'pending' ? '<span class="stock">Awaiting payment</span>'
                : (o.status === 'toship' ? '<button class="btn btn-sm btn-soft" data-ship>Ship out</button> ' : '') + '<button class="btn btn-sm btn-danger" data-complete>Complete order</button>';
            return `<tr data-id="${esc(o.id)}">
                <td>#${esc(o.id)}</td><td>${esc(o.customer)}</td>
                <td>${esc(o.items.map(i => `${i.title} (x${i.qty})`).join(', '))}</td>
                <td>${money(o.total)}</td>
                <td><span class="status ${o.status}">${ORDER_STATUS[o.status].label}</span></td>
                <td><input type="date" class="edit-input date" data-date value="${esc(o.receiveDate || '')}" ${done ? 'disabled' : ''} aria-label="When to receive"></td>
                <td class="actions">${action}</td></tr>`;
        }).join('') || '<tr><td colspan="7" class="table-empty">No orders yet.</td></tr>';
        renderMetrics();
    }

    tbody.addEventListener('click', e => {
        const row = e.target.closest('tr[data-id]');
        if (!row) return;
        if (e.target.closest('[data-ship]')) {
            const orders = read(KEY.orders, []);
            orders.find(o => o.id === row.dataset.id).status = 'toreceive';
            saveOrders(orders); toast('Order marked as shipped out.');
        }
        if (e.target.closest('[data-complete]')) { pendingId = row.dataset.id; proofInput.click(); }
    });
    tbody.addEventListener('change', e => {
        if (!e.target.matches('[data-date]')) return;
        const orders = read(KEY.orders, []);
        orders.find(o => o.id === e.target.closest('tr').dataset.id).receiveDate = e.target.value;
        write(KEY.orders, orders); toast('Delivery date saved.');
    });
    proofInput.addEventListener('change', () => {
        const file = proofInput.files[0];
        if (!file || !pendingId) return toast('Image proof is required to complete this order.', 'error');
        const orders = read(KEY.orders, []), order = orders.find(o => o.id === pendingId);
        order.status = 'completed'; order.proof = file.name;
        proofInput.value = ''; pendingId = null;
        saveOrders(orders); toast('Order completed, proof uploaded, and date locked.');
    });

    $('#reportBtn').addEventListener('click', () => {
        const rows = [['Order ID', 'Customer', 'Items', 'Total', 'Status', 'Receive date']].concat(read(KEY.orders, []).map(o => [o.id, o.customer, o.items.map(i => `${i.title} x${i.qty}`).join('; '), o.total.toFixed(2), ORDER_STATUS[o.status].label, o.receiveDate]));
        const csv = rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
        const link = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: 'iwantpc-orders-report.csv' });
        link.click();
        write(KEY.reports, read(KEY.reports, 0) + 1);
        renderMetrics(); toast('Report generated.');
    });

    document.addEventListener('inventory:changed', renderMetrics);
    setupInventory($('#inventoryBody'), { addButton: $('#addProductBtn') });
    renderQueue();
};

pages.admin = () => {
    const admin = guard(['admin']);
    if (!admin) return;
    const usersBody = $('#usersBody'), servicesBody = $('#servicesBody');

    const renderMetrics = () => {
        $('#mRevenue').textContent = money(revenue());
        $('#mOrders').textContent = read(KEY.orders, []).length;
        $('#mAccounts').textContent = read(KEY.users, []).length;
        $('#mServices').textContent = read(KEY.bookings, []).filter(b => b.status === 'Under Review').length;
    };
    const renderUsers = () => {
        usersBody.innerHTML = read(KEY.users, []).map(u => `
            <tr data-id="${esc(u.id)}" class="${u.active ? '' : 'is-suspended'}">
                <td>#${esc(u.id)}</td><td>${esc(u.name)}</td><td>${esc(u.email)}</td>
                <td>
                    <select class="edit-input" data-role aria-label="Role for ${esc(u.name)}" ${u.id === admin.id ? 'disabled' : ''}>
                        ${['admin', 'staff', 'customer'].map(r => `<option value="${r}"${r === u.role ? ' selected' : ''}>${r[0].toUpperCase() + r.slice(1)}</option>`).join('')}
                    </select>
                </td>
                <td><span class="status ${u.active ? u.role : 'suspended'}">${u.active ? 'Active' : 'Suspended'}</span></td>
                <td class="actions">${u.id === admin.id ? '<span class="stock">This is you</span>' : `<button class="btn btn-sm ${u.active ? 'btn-outline danger' : 'btn-soft'}" data-toggle>${u.active ? 'Suspend' : 'Reactivate'}</button>`}</td>
            </tr>`).join('');
        renderMetrics();
    };
    const renderServices = () => {
        const statusClass = { 'Under Review': 'pending', Approved: 'approved', Rejected: 'rejected' };
        servicesBody.innerHTML = read(KEY.bookings, []).map(b => `
            <tr data-id="${esc(b.id)}">
                <td>#${esc(b.id)}</td><td>${esc(b.customer)}</td><td>${esc(b.device)}</td><td>${esc(b.type)}</td>
                <td><span class="status ${statusClass[b.status]}">${esc(b.status)}</span></td>
                <td class="actions">${b.status === 'Under Review' ? '<button class="btn btn-sm btn-soft" data-decide="Approved">Approve</button><button class="btn btn-sm btn-outline danger" data-decide="Rejected">Reject</button>' : ''}</td>
            </tr>`).join('') || '<tr><td colspan="6" class="table-empty">No service tickets yet.</td></tr>';
        renderMetrics();
    };
    const updateUser = (id, change) => {
        const users = read(KEY.users, []);
        change(users.find(u => u.id === id));
        write(KEY.users, users);
        renderUsers();
    };

    usersBody.addEventListener('change', e => {
        if (e.target.matches('[data-role]')) { updateUser(e.target.closest('tr').dataset.id, u => { u.role = e.target.value; }); toast('Role updated.'); }
    });
    usersBody.addEventListener('click', e => {
        if (!e.target.closest('[data-toggle]')) return;
        updateUser(e.target.closest('tr').dataset.id, u => { u.active = !u.active; });
        toast('Account status updated.');
    });
    servicesBody.addEventListener('click', e => {
        const btn = e.target.closest('[data-decide]');
        if (!btn) return;
        const bookings = read(KEY.bookings, []);
        bookings.find(b => b.id === btn.closest('tr').dataset.id).status = btn.dataset.decide;
        write(KEY.bookings, bookings);
        renderServices(); toast(`Claim ${btn.dataset.decide.toLowerCase()}.`);
    });
    $('#addUserBtn').addEventListener('click', () => {
        const name = (prompt('Full name of the new user:') || '').trim();
        const email = (prompt('Email address:') || '').trim().toLowerCase();
        if (!name || !email) return;
        const users = read(KEY.users, []);     /* was an undeclared variable (crashed in strict mode) */
        if (users.some(u => u.email.toLowerCase() === email)) return toast('That email already has an account.', 'error');
        users.push(person({ id: 'USR-' + String(users.length + 1).padStart(3, '0'), name, username: email.split('@')[0], email, password: 'changeme123', role: 'customer' }));
        write(KEY.users, users);
        renderUsers(); toast('User added with the temporary password "changeme123".');
    });

    setupInventory($('#inventoryBody'), { canDelete: true, addButton: $('#addProductBtn') });
    renderUsers();
    renderServices();
};

/* ===== Boot ===== */
document.addEventListener('DOMContentLoaded', () => {
    const footer = $('#footer');
    if (footer) {
        footer.className = 'footer';
        footer.innerHTML = '<div class="footer-container"><p class="copyright">&copy; 2026 iWant PC Inc. All rights reserved.</p><div class="footer-links"><a href="#">Privacy Policy</a><a href="#">Terms of Service</a></div></div>';
    }
    document.addEventListener('click', e => { if (e.target.closest('[data-logout]')) localStorage.removeItem(KEY.session); });
    const init = pages[document.body.dataset.page];
    if (init) Promise.resolve(init()).catch(err => { console.error(err); toast(esc(err.message || 'Something went wrong loading this page.'), 'error'); });
});
