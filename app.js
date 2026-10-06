alert("APP JS IS LOADING");console.log("1 - JS started");

const cfg = window.IMAGINEIT_CONFIG || {};

console.log("2 - config loaded", cfg);

const configured =
  cfg.SUPABASE_URL &&
  !cfg.SUPABASE_URL.startsWith("YOUR_") &&
  cfg.SUPABASE_ANON_KEY &&
  !cfg.SUPABASE_ANON_KEY.startsWith("YOUR_");

const sb = configured
  ? window.supabase.createClient(
      cfg.SUPABASE_URL,
      cfg.SUPABASE_ANON_KEY
    )
  : null;window.supabaseClient = sb;

const $ = id => document.getElementById(id);

const esc = s =>
  String(s ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[c]));

const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Colombo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());

const money = n =>
  "Rs. " + Number(n || 0).toLocaleString("en-LK");

const num = n => Number(n || 0);

const monthKey = date => {
  if (!date) return "";

  const value = String(date);

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value.slice(0, 7);
  }

  const d = new Date(date);

  if (Number.isNaN(d.getTime())) return "";

  return (
    d.getFullYear() +
    "-" +
    String(d.getMonth() + 1).padStart(2, "0")
  );
};


/* =========================
   DATE HELPERS
========================= */

function dateObject(date) {
  if (!date) return null;

  const [y, m, d] =
    String(date).split("-").map(Number);

  if (!y || !m || !d) return null;

  return new Date(
    Date.UTC(y, m - 1, d)
  );
}

function daysBetween(start, end) {
  const a = dateObject(start);
  const b = dateObject(end);

  if (!a || !b) return 0;

  return Math.round(
    (b - a) / 86400000
  );
}

function rentalDays(r) {
  return Math.max(
    daysBetween(
      r.pickup_date,
      r.return_date
    ) + 1,
    1
  );
}

function daysLate(r) {
  if (!r?.return_date) return 0;

  const actual =
    r.status === "returned" &&
    r.actual_return_date
      ? r.actual_return_date
      : today();

  return Math.max(
    daysBetween(
      r.return_date,
      actual
    ),
    0
  );
}

function daysLateText(r) {
  const late = daysLate(r);

  if (late <= 0) return "";

  return late === 1
    ? "1 day late"
    : `${late} days late`;
}

function returnTimingText(r) {
  if (
    r.status !== "returned" ||
    !r.actual_return_date ||
    !r.return_date
  ) {
    return "";
  }

  const difference = daysBetween(
    r.return_date,
    r.actual_return_date
  );

  if (difference > 0) {
    return difference === 1
      ? "1 day late"
      : `${difference} days late`;
  }

  if (difference < 0) {
    const early = Math.abs(difference);

    return early === 1
      ? "1 day early"
      : `${early} days early`;
  }

  return "Returned on time";
}

function formatDate(date) {
  if (!date) return "—";

  const d = dateObject(date);

  if (!d) return date;

  return d.toLocaleDateString(
    "en-LK",
    {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC"
    }
  );
}

function tomorrow() {
  const d = dateObject(today());

  d.setUTCDate(
    d.getUTCDate() + 1
  );

  return d.toISOString().slice(0, 10);
}


/* =========================
   STATE
========================= */

let data = {
  items: [],
  customers: [],
  rentals: []
};

let view = "dashboard";

let calendarDate = new Date();

let currentReturnId = null;


/* =========================
   LOGIN
========================= */

async function boot() {
  if (!configured) {
    loginScreen(true);
    return;
  }

  const {
    data: { session }
  } = await sb.auth.getSession();

  if (session) {
    render();
  } else {
    loginScreen(false);
  }

  sb.auth.onAuthStateChange(
    (_event, session) => {
      if (session) {
        render();
      } else {
        loginScreen(false);
      }
    }
  );
}

function loginScreen(configError) {
  $("app").innerHTML = `
    <main class="login">
      <section class="login-card">

        <div class="logo">
          ImagineIt<br>
          <span>Fashion Library</span>
        </div>

        ${
          configError
            ? `
              <div class="alert">
                Supabase isn't connected yet.
                Open <b>config.js</b> and add your Supabase
                Project URL and publishable/anon key.
              </div>
            `
            : ""
        }

        <h1>Admin login</h1>

        <p>
          Manage rentals, inventory, customers
          and availability.
        </p>

        <input
          id="email"
          class="input"
          placeholder="Email"
          type="email"
        >

        <input
          id="password"
          class="input"
          placeholder="Password"
          type="password"
        >

        <button
          type="button"
          class="btn wide"
          onclick="login()"
        >
          Sign in
        </button>

        <div id="loginmsg"></div>

      </section>
    </main>
  `;
}

async function login() {
  const email =
    $("email").value.trim();

  const password =
    $("password").value;

  const { error } =
    await sb.auth.signInWithPassword({
      email,
      password
    });

  if (error) {
    $("loginmsg").innerHTML = `
      <div class="alert">
        ${esc(error.message)}
      </div>
    `;
  }
}

async function logout() {
  await sb.auth.signOut();
}


/* =========================
   DATABASE
========================= */

async function load() {
  const [i, c, r] =
    await Promise.all([
      sb
        .from("items")
        .select("*")
        .eq("active", true)
        .order("created_at", {
          ascending: false
        }),

      sb
        .from("customers")
        .select("*")
        .order("created_at", {
          ascending: false
        }),

      sb
        .from("rentals")
        .select(`
          *,
          customers(name,phone,email),
          items(
            name,
            category,
            size,
            color,
            rental_price,
            deposit
          )
        `)
        .order("return_date", {
          ascending: true
        })
    ]);

  if (i.error || c.error || r.error) {
    throw (
      i.error ||
      c.error ||
      r.error
    );
  }

  data = {
    items: i.data || [],
    customers: c.data || [],
    rentals: r.data || []
  };
}


/* =========================
   MAIN RENDER
========================= */

async function render() {
  try {
    await load();
  } catch (e) {
    $("app").innerHTML = `
      <div class="error">
        ${esc(e.message)}
      </div>
    `;

    return;
  }

  $("app").innerHTML = `
    <div class="layout">

      <aside>

        <div class="brand">
          ImagineIt<br>
          Fashion Library
        </div>

        <div class="tag">
          RENT • WEAR • RETURN
        </div>

        <nav>
          ${nav("dashboard", "📊 Dashboard")}
          ${nav("calendar", "📅 Availability")}
          ${nav("rentals", "🧾 Rentals")}
          ${nav("inventory", "👗 Inventory")}
          ${nav("customers", "👥 Customers")}

          ${nav("reminders", "💬 Reminders")}
        </nav>

        <button
          type="button"
          class="logout"
          onclick="logout()"
        >
          Log out
        </button>

      </aside>

      <main>

        <header>

          <div>
            <div class="title">
              ${viewTitle()}
            </div>

            <div class="sub">
              ImagineIt Fashion Library admin
            </div>
          </div>

          <button
            type="button"
            class="btn"
            onclick="openRental()"
          >
            + New Rental
          </button>

        </header>

        <div id="content"></div>

      </main>

    </div>
  `;

  if (view === "dashboard") {
    dashboard();
  }

  if (view === "calendar") {
    calendar();
  }

  if (view === "rentals") {
    rentals();
  }

  if (view === "inventory") {
    inventory();
  }

  if (view === "customers") {
    customers();
  }

  if (view === "reminders") {
    reminders();
  }
}

function nav(v, t) {
  return `
    <button
      type="button"
      class="${view === v ? "active" : ""}"
      onclick="view='${v}';render()"
    >
      ${t}
    </button>
  `;
}

function viewTitle() {
  return {
    dashboard: "Dashboard",
    calendar: "Availability Calendar",
    rentals: "Rentals",
    inventory: "Inventory",
    customers: "Customers",
    reminders: "WhatsApp Reminders"
  }[view];
}


/* =========================
   RENTAL STATUS
========================= */

function rentalStatus(r) {
  if (r.status === "returned") {
    return "Returned";
  }

  if (r.status === "cancelled") {
    return "Cancelled";
  }

  if (r.return_date < today()) {
    return "Overdue";
  }

  if (r.return_date === today()) {
    return "Due today";
  }

  return "Active";
}


/* =========================
   STATS
========================= */

function stats() {
  const active =
    data.rentals.filter(
      r => r.status === "active"
    );

  const due =
    active.filter(
      r => r.return_date === today()
    );

  const over =
    active.filter(
      r => r.return_date < today()
    );

  const returned =
    data.rentals.filter(
      r => r.status === "returned"
    );

  const outstanding =
    data.rentals
      .filter(
        r => r.status !== "cancelled"
      )
      .reduce(
        (total, r) =>
          total +
          Math.max(
            num(r.price) -
            num(r.payment_received),
            0
          ),
        0
      );

  const depositsHeld =
    data.rentals
      .filter(
        r => r.status !== "cancelled"
      )
      .reduce(
        (total, r) =>
          total +
          Math.max(
            num(r.deposit_received) -
            num(r.deposit_returned),
            0
          ),
        0
      );

  return {
    active,
    due,
    over,
    returned,
    outstanding,
    depositsHeld
  };
}


/* =========================
   MONTHLY DATA
========================= */

function currentMonthData() {
  const current =
    monthKey(today());

  const rentals =
    data.rentals.filter(
      r =>
        r.status !== "cancelled" &&
        monthKey(r.created_at) === current
    );

  const income =
    rentals.reduce(
      (total, r) =>
        total +
        num(r.payment_received),
      0
    );

  return {
    rentals,
    income,
    pieces: rentals.length
  };
}

function getMonthlyHistory() {
  const months = [];
  const now = new Date();

  for (let i = 5; i >= 0; i--) {
    const d =
      new Date(
        now.getFullYear(),
        now.getMonth() - i,
        1
      );

    const key =
      monthKey(
        d.toISOString()
      );

    const label =
      d.toLocaleDateString(
        "en-LK",
        {
          month: "short",
          year: "numeric"
        }
      );

    const rentals =
      data.rentals.filter(
        r =>
          r.status !== "cancelled" &&
          monthKey(r.created_at) === key
      );

    const income =
      rentals.reduce(
        (total, r) =>
          total +
          num(r.payment_received),
        0
      );

    months.push({
      key,
      label,
      income,
      orders: rentals.length
    });
  }

  return months;
}


/* =========================
   POPULAR ITEMS
========================= */

function mostRentedItems() {
  const counts = {};

  data.rentals
    .filter(
      r => r.status !== "cancelled"
    )
    .forEach(r => {
      if (!r.item_id) return;

      if (!counts[r.item_id]) {
        counts[r.item_id] = {
          id: r.item_id,
          name:
            r.items?.name ||
            "Unknown item",
          category:
            r.items?.category ||
            "",
          count: 0
        };
      }

      counts[r.item_id].count++;
    });

  return Object.values(counts)
    .sort(
      (a, b) =>
        b.count - a.count
    )
    .slice(0, 5);
}


/* =========================
   DASHBOARD HELPERS
========================= */

function todayPickups() {
  return data.rentals.filter(
    r =>
      r.status === "active" &&
      r.pickup_date === today()
  );
}

function todayReturns() {
  return data.rentals.filter(
    r =>
      r.status === "active" &&
      r.return_date === today()
  );
}

function availableItems() {
  const rentedItemIds =
    new Set(
      data.rentals
        .filter(
          r =>
            r.status === "active" &&
            r.pickup_date <= today() &&
            r.return_date >= today()
        )
        .map(
          r => r.item_id
        )
    );

  return data.items.filter(
    item =>
      !rentedItemIds.has(item.id)
  );
}

function newCustomersThisMonth() {
  const current =
    monthKey(today());

  return data.customers.filter(
    c =>
      c.created_at &&
      monthKey(c.created_at) === current
  );
}

function upcomingBookings() {
  return data.rentals
    .filter(
      r =>
        r.status === "active" &&
        r.pickup_date >= today()
    )
    .sort(
      (a, b) =>
        a.pickup_date.localeCompare(
          b.pickup_date
        )
    )
    .slice(0, 8);
}

function totalRevenue() {
  return data.rentals
    .filter(
      r => r.status !== "cancelled"
    )
    .reduce(
      (total, r) =>
        total +
        num(r.payment_received),
      0
    );
}


/* =========================
   DASHBOARD
========================= */

function dashboard() {
  const s = stats();
  const m = currentMonthData();
  const history = getMonthlyHistory();
  const popular = mostRentedItems();
  const pickups = todayPickups();
  const returns = todayReturns();
  const available = availableItems();
  const newCustomers =
    newCustomersThisMonth();
  const upcoming =
    upcomingBookings();

  const maxIncome =
    Math.max(
      ...history.map(
        x => x.income
      ),
      1
    );

  const remindersList = [];

  const uncontactedReminders =
    remindersList.filter(
      r => !reminderWasContacted(r.id)
    );

  $("content").innerHTML = `
    <section class="hero">

      <div>
        <h1>
          Welcome to ImagineIt ✨
        </h1>

        <p>
          Your rental business at a glance.
        </p>
      </div>

      <div class="hero-date">
        ${new Date().toLocaleDateString(
          "en-LK",
          {
            weekday: "long",
            day: "numeric",
            month: "long",
            year: "numeric"
          }
        )}
      </div>

    </section>

    ${
      uncontactedReminders.length
        ? `
          <section class="panel">

            <div class="panel-heading">

              <div>
                <h2>
                  💬 Customer reminders
                </h2>

                <p class="muted">
                  Customers who may need to be contacted.
                </p>
              </div>

              <button
                type="button"
                class="btn"
                onclick="view='reminders';render()"
              >
                View
                ${uncontactedReminders.length}
              </button>

            </div>

            <div class="grid4">

              <div class="card">
                <small>
                  🚨 Need attention
                </small>
                <b>
                  ${uncontactedReminders.length}
                </b>
              </div>

              <div class="card">
                <small>
                  📦 Pickup tomorrow
                </small>
                <b>
                  ${
                    uncontactedReminders.filter(
                      r =>
                        r.type === "pickup"
                    ).length
                  }
                </b>
              </div>

              <div class="card">
                <small>
                  🔄 Return reminders
                </small>
                <b>
                  ${
                    uncontactedReminders.filter(
                      r =>
                        r.type ===
                          "return-tomorrow" ||
                        r.type ===
                          "return-today" ||
                        r.type ===
                          "overdue"
                    ).length
                  }
                </b>
              </div>

              <div class="card">
                <small>
                  💰 Payment reminders
                </small>
                <b>
                  ${
                    uncontactedReminders.filter(
                      r =>
                        r.type ===
                        "payment"
                    ).length
                  }
                </b>
              </div>

            </div>

          </section>
        `
        : ""
    }

    <div class="section-label">
      THIS MONTH
    </div>

    <div class="grid4">

      <div class="card stat-income">
        <small>
          💰 Income received
        </small>
        <b>
          ${money(m.income)}
        </b>
      </div>

      <div class="card">
        <small>
          🧾 Rental orders
        </small>
        <b>
          ${m.rentals.length}
        </b>
      </div>

      <div class="card">
        <small>
          👗 Items rented
        </small>
        <b>
          ${m.pieces}
        </b>
      </div>

      <div class="card">
        <small>
          👥 New customers
        </small>
        <b>
          ${newCustomers.length}
        </b>
      </div>

    </div>

    <div class="section-label">
      RIGHT NOW
    </div>

    <div class="grid4">

      <div class="card">
        <small>
          🟢 Active rentals
        </small>
        <b>
          ${s.active.length}
        </b>
      </div>

      <div class="card">
        <small>
          📦 Available pieces
        </small>
        <b>
          ${available.length}
        </b>
      </div>

      <div class="card">
        <small>
          ⏰ Due today
        </small>
        <b>
          ${s.due.length}
        </b>
      </div>

      <div class="card">
        <small>
          🚨 Overdue
        </small>
        <b>
          ${s.over.length}
        </b>
      </div>

    </div>

    <section class="panel">

      <div class="panel-heading">

        <div>
          <h2>
            📅 Today's activity
          </h2>

          <p class="muted">
            Everything happening with your rentals today.
          </p>
        </div>

      </div>

      <div class="grid4">

        <div class="card">
          <small>
            📦 Pickups today
          </small>
          <b>
            ${pickups.length}
          </b>
        </div>

        <div class="card">
          <small>
            🔄 Returns today
          </small>
          <b>
            ${returns.length}
          </b>
        </div>

        <div class="card">
          <small>
            💸 Outstanding
          </small>
          <b>
            ${money(s.outstanding)}
          </b>
        </div>

        <div class="card">
          <small>
            💰 Deposits held
          </small>
          <b>
            ${money(s.depositsHeld)}
          </b>
        </div>

      </div>

      ${
        pickups.length
          ? `
            <h3 style="margin-top:24px;">
              📦 Pickups
            </h3>

            ${rentalsTable(pickups)}
          `
          : `
            <div class="empty">
              🎀 No pickups scheduled for today.
            </div>
          `
      }

      ${
        returns.length
          ? `
            <h3 style="margin-top:24px;">
              🔄 Returns
            </h3>

            ${rentalsTable(returns)}
          `
          : `
            <div class="empty">
              ✨ No returns scheduled for today.
            </div>
          `
      }

    </section>

    <section class="panel">

      <div class="panel-heading">

        <div>
          <button
  class="btn primary"
  onclick="setupPushNotifications()"
  style="margin-bottom:16px;"
>
  🔔 Enable Phone Notifications
</button><h2>
            🚨 Attention needed
          </h2>

          <p class="muted">
            Rentals that need your attention.
          </p>
        </div>

        ${
          s.over.length
            ? `
              <span class="warning-count">
                ${s.over.length} overdue
              </span>
            `
            : `
              <span class="pill">
                All clear
              </span>
            `
        }

      </div>

      ${
        [...s.over, ...s.due].length
          ? rentalsTable([
              ...s.over,
              ...s.due
            ])
          : `
            <div class="empty">
              🎀 No overdue or due rentals right now.
            </div>
          `
      }

    </section>

    <div class="grid2">

      <section class="panel">

        <h2>
          💵 This month's income
        </h2>

        <div class="big-number">
          ${money(m.income)}
        </div>

        <p class="muted">
          Money actually received from rental payments
          recorded this month.
        </p>

      </section>

      <section class="panel">

        <h2>
          📊 Business overview
        </h2>

        <div class="mini-stat">
          <span>
            Total inventory
          </span>
          <b>
            ${data.items.length}
          </b>
        </div>

        <div class="mini-stat">
          <span>
            Available today
          </span>
          <b>
            ${available.length}
          </b>
        </div>

        <div class="mini-stat">
          <span>
            Total customers
          </span>
          <b>
            ${data.customers.length}
          </b>
        </div>

        <div class="mini-stat">
          <span>
            Total rentals
          </span>
          <b>
            ${
              data.rentals.filter(
                r =>
                  r.status !==
                  "cancelled"
              ).length
            }
          </b>
        </div>

        <div class="mini-stat">
          <span>
            Total income
          </span>
          <b>
            ${money(totalRevenue())}
          </b>
        </div>

      </section>

    </div>

    <section class="panel">

      <div class="panel-heading">

        <div>
          <h2>
            📈 Income history
          </h2>

          <p class="muted">
            Payment amounts recorded over the last 6 months.
          </p>
        </div>

      </div>

      <div class="income-history">

        ${
          history.map(x => {

            const height =
              x.income > 0
                ? Math.max(
                    8,
                    Math.round(
                      (x.income /
                        maxIncome) *
                      150
                    )
                  )
                : 4;

            return `
              <div class="income-month">

                <div class="income-value">
                  ${
                    x.income
                      ? money(x.income)
                      : "—"
                  }
                </div>

                <div
                  class="income-bar"
                  style="height:${height}px"
                ></div>

                <div class="income-label">
                  ${esc(x.label)}
                </div>

                <small>
                  ${x.orders}
                  order${x.orders === 1 ? "" : "s"}
                </small>

              </div>
            `;
          }).join("")
        }

      </div>

    </section>

    <section class="panel">

      <div class="panel-heading">

        <div>
          <h2>
            🏆 Most rented pieces
          </h2>

          <p class="muted">
            Your most popular rental pieces.
          </p>
        </div>

      </div>

      ${
        popular.length
          ? `
            <div class="popular-list">

              ${
                popular.map(
                  (item, index) => `
                    <div class="popular-item">

                      <div class="rank">
                        ${index + 1}
                      </div>

                      <div class="popular-info">

                        <b>
                          ${esc(item.name)}
                        </b>

                        <small>
                          ${esc(item.category)}
                        </small>

                      </div>

                      <div class="popular-count">
                        ${item.count}

                        <small>
                          rental${
                            item.count === 1
                              ? ""
                              : "s"
                          }
                        </small>
                      </div>

                    </div>
                  `
                ).join("")
              }

            </div>
          `
          : `
            <div class="empty">
              Your most-rented pieces will appear here
              once you start recording rentals. 👗
            </div>
          `
      }

    </section>

    <section class="panel">

      <div class="panel-heading">

        <div>
          <h2>
            📆 Upcoming bookings
          </h2>

          <p class="muted">
            Your next scheduled pickups and returns.
          </p>
        </div>

      </div>

      ${
        upcoming.length
          ? rentalsTable(upcoming)
          : `
            <div class="empty">
              No upcoming bookings yet.
            </div>
          `
      }

    </section>
  `;
}


/* =========================
   RENTAL TABLE
========================= */

function rentalsTable(list) {
  if (!list.length) {
    return `
      <div class="empty">
        Nothing here yet.
      </div>
    `;
  }

  return `
    <div class="tablewrap">

      <table>

        <thead>
          <tr>
            <th>Customer</th>
            <th>Item</th>
            <th>Rental</th>
            <th>Return</th>
            <th>Payment</th>
            <th>Deposit</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>

        <tbody>

          ${
            list.map(r => {

              const remaining =
                Math.max(
                  num(r.price) -
                  num(r.payment_received),
                  0
                );

              const lateText =
                r.status === "returned"
                  ? daysLateText(r)
                  : r.status === "active" &&
                    r.return_date < today()
                    ? daysLateText(r)
                    : "";

              const timing =
                returnTimingText(r);

              return `
                <tr>

                  <td>
                    <b>
                      ${esc(
                        r.customers?.name ||
                        "Unknown"
                      )}
                    </b>

                    <br>

                    <small>
                      ${esc(
                        r.customers?.phone ||
                        "No phone"
                      )}
                    </small>
                  </td>

                  <td>
                    ${esc(
                      r.items?.name ||
                      "Unknown item"
                    )}
                  </td>

                  <td>
                    ${formatDate(
                      r.pickup_date
                    )}

                    <br>

                    <small>
                      ${rentalDays(r)}
                      day${
                        rentalDays(r) === 1
                          ? ""
                          : "s"
                      }
                    </small>
                  </td>

                  <td>

                    <b>
                      Expected:
                    </b>

                    ${formatDate(
                      r.return_date
                    )}

                    ${
                      r.actual_return_date
                        ? `
                          <br>

                          <b>
                            Actual:
                          </b>

                          ${formatDate(
                            r.actual_return_date
                          )}
                        `
                        : ""
                    }

                    ${
                      timing
                        ? `
                          <br>

                          <small>
                            ${
                              timing ===
                              "Returned on time"
                                ? "✅ "
                                : "🚨 "
                            }

                            ${esc(timing)}
                          </small>
                        `
                        : ""
                    }

                    ${
                      lateText &&
                      !r.actual_return_date
                        ? `
                          <br>

                          <small
                            style="
                              color:#b00020;
                              font-weight:700;
                            "
                          >
                            🚨
                            ${esc(lateText)}
                          </small>
                        `
                        : ""
                    }

                  </td>

                  <td>

                    ${money(
                      r.payment_received
                    )}

                    <br>

                    <small>
                      ${
                        remaining > 0
                          ? `
                            ${money(
                              remaining
                            )}
                            remaining
                          `
                          : "Paid in full"
                      }
                    </small>

                  </td>

                  <td>

                    ${money(
                      r.deposit_received
                    )}

                    <br>

                    <small>
                      ${
                        Math.max(
                          num(
                            r.deposit_received
                          ) -
                          num(
                            r.deposit_returned
                          ),
                          0
                        ) > 0
                          ? "Held"
                          : "Returned"
                      }
                    </small>

                  </td>

                  <td>

                    <span
                      class="
                        pill
                        ${rentalStatus(r)
                          .replaceAll(
                            " ",
                            "-"
                          )
                          .toLowerCase()}
                      "
                    >
                      ${rentalStatus(r)}
                    </span>

                  </td>

                  <td>

                    ${
                      r.status === "active"
                        ? `
                          <button
                            type="button"
                            class="btn sm"
                            onclick="returned('${r.id}')"
                          >
                            Return
                          </button>
                        `
                        : ""
                    }

                    <button
                      type="button"
                      class="btn sm secondary"
                      onclick="message('${r.id}')"
                    >
                      💬 Message
                    </button>

                  </td>

                </tr>
              `;
            }).join("")
          }

        </tbody>

      </table>

    </div>
  `;
}


/* =========================
   RENTALS PAGE
========================= */

function rentals() {
  $("content").innerHTML = `
    <section class="panel">

      <div class="toolbar">

        <input
          id="rq"
          class="input"
          placeholder="Search customer/item..."
          oninput="filterR()"
        >

        <select
          id="rf"
          class="select"
          onchange="filterR()"
        >
          <option>All</option>
          <option>Active</option>
          <option>Due today</option>
          <option>Overdue</option>
          <option>Returned</option>
        </select>

      </div>

      <div id="rtable"></div>

    </section>
  `;

  filterR();
}

function filterR() {
  const q =
    ($("rq")?.value || "")
      .toLowerCase();

  const f =
    $("rf")?.value || "All";

  let x =
    data.rentals.filter(r =>
      (
        (r.customers?.name || "") +
        " " +
        (r.items?.name || "") +
        " " +
        (r.customers?.phone || "")
      )
        .toLowerCase()
        .includes(q)
    );

  if (f !== "All") {
    x = x.filter(
      r =>
        rentalStatus(r) === f
    );
  }

  $("rtable").innerHTML =
    rentalsTable(x);
}


/* =========================
   CALENDAR
========================= */

function calendar() {
  const year =
    calendarDate.getFullYear();

  const month =
    calendarDate.getMonth();

  const firstDay =
    new Date(
      year,
      month,
      1
    );

  const daysInMonth =
    new Date(
      year,
      month + 1,
      0
    ).getDate();

  const startingDay =
    firstDay.getDay();

  const monthName =
    firstDay.toLocaleDateString(
      "en-LK",
      {
        month: "long",
        year: "numeric"
      }
    );

  let cells = "";

  for (
    let i = 0;
    i < startingDay;
    i++
  ) {
    cells += `
      <div class="day empty-day"></div>
    `;
  }

  for (
    let d = 1;
    d <= daysInMonth;
    d++
  ) {
    const dateString =
      year +
      "-" +
      String(month + 1)
        .padStart(2, "0") +
      "-" +
      String(d)
        .padStart(2, "0");

    const bookings =
      data.rentals.filter(
        r =>
          r.status === "active" &&
          dateString >= r.pickup_date &&
          dateString <= r.return_date
      );

    const isToday =
      dateString === today();

    cells += `
      <div
        class="
          day
          ${isToday ? "today-day" : ""}
        "
      >

        <div class="day-number">

          ${d}

          ${
            isToday
              ? `
                <span class="today-label">
                  TODAY
                </span>
              `
              : ""
          }

        </div>

        ${
          bookings.length
            ? bookings.map(
                r => `
                  <div
                    class="booking"
                    title="${esc(
                      r.customers?.name
                    )} — ${esc(
                      r.items?.name
                    )}"
                  >
                    <b>
                      ${esc(
                        r.items?.name
                      )}
                    </b>

                    <small>
                      ${esc(
                        r.customers?.name
                      )}
                    </small>
                  </div>
                `
              ).join("")
            : `
              <div class="available">
                Available
              </div>
            `
        }

      </div>
    `;
  }

  $("content").innerHTML = `
    <section class="panel">

      <div class="calendar-header">

        <button
          type="button"
          class="calendar-nav"
          onclick="changeCalendarMonth(-1)"
        >
          ◀
        </button>

        <div class="calendar-title">

          <h2>
            ${esc(monthName)}
          </h2>

          <small>
            ${bookingsSummary(
              year,
              month
            )}
          </small>

        </div>

        <button
          type="button"
          class="calendar-nav"
          onclick="changeCalendarMonth(1)"
        >
          ▶
        </button>

      </div>

      <div class="calendar-weekdays">
        <div>Sun</div>
        <div>Mon</div>
        <div>Tue</div>
        <div>Wed</div>
        <div>Thu</div>
        <div>Fri</div>
        <div>Sat</div>
      </div>

      <div class="calendar">
        ${cells}
      </div>

      <div class="calendar-legend">

        <span>
          <i class="legend-dot available-dot"></i>
          Available
        </span>

        <span>
          <i class="legend-dot booked-dot"></i>
          Booked
        </span>

        <span>
          <i class="legend-dot today-dot"></i>
          Today
        </span>

      </div>

    </section>
  `;
}

function changeCalendarMonth(amount) {
  calendarDate.setMonth(
    calendarDate.getMonth() + amount
  );

  calendar();
}

function bookingsSummary(
  year,
  month
) {
  const prefix =
    year +
    "-" +
    String(month + 1)
      .padStart(2, "0");

  const bookings =
    data.rentals.filter(
      r =>
        r.status === "active" &&
        (
          r.pickup_date.startsWith(
            prefix
          ) ||
          r.return_date.startsWith(
            prefix
          ) ||
          (
            r.pickup_date <
              prefix + "-01" &&
            r.return_date >=
              prefix + "-01"
          )
        )
    );

  const uniqueItems =
    new Set(
      bookings.map(
        r => r.item_id
      )
    ).size;

  return `
    ${bookings.length}
    active booking${
      bookings.length === 1
        ? ""
        : "s"
    }

    •

    ${uniqueItems}
    piece${
      uniqueItems === 1
        ? ""
        : "s"
    } booked
  `;
}


/* =========================
   INVENTORY
========================= */

function inventory() {
  $("content").innerHTML = `
    <section class="panel">

      <div class="toolbar">

        <button
          type="button"
          class="btn"
          onclick="openItem()"
        >
          + Add piece
        </button>

        <input
          id="iq"
          class="input"
          placeholder="Search inventory..."
          oninput="filterI()"
        >

      </div>

      <div id="itable"></div>

    </section>
  `;

  filterI();
}

function filterI() {
  const q =
    ($("iq")?.value || "")
      .toLowerCase();

  const x =
    data.items.filter(i =>
      (
        i.name +
        " " +
        i.category +
        " " +
        i.color +
        " " +
        i.size
      )
        .toLowerCase()
        .includes(q)
    );

  $("itable").innerHTML = `
    <div class="tablewrap">

      <table>

        <thead>
          <tr>
            <th>Piece</th>
            <th>Category</th>
            <th>Size</th>
            <th>Colour</th>
            <th>Rental</th>
            <th>Deposit</th>
          </tr>
        </thead>

        <tbody>

          ${
            x.map(i => `
              <tr>

                <td>
                  <b>
                    ${esc(i.name)}
                  </b>
                </td>

                <td>
                  ${esc(i.category)}
                </td>

                <td>
                  ${esc(i.size)}
                </td>

                <td>
                  ${esc(i.color)}
                </td>

                <td>
                  ${money(i.rental_price)}
                </td>

                <td>
                  ${money(i.deposit)}
                </td>

              </tr>
            `).join("")
          }

        </tbody>

      </table>

    </div>
  `;
}


/* =========================
   CUSTOMERS
========================= */

function customers() {
  $("content").innerHTML = `
    <section class="panel">

      <div class="toolbar">

        <button
          type="button"
          class="btn"
          onclick="openCustomer()"
        >
          + Add customer
        </button>

      </div>

      <div class="tablewrap">

        <table>

          <thead>
            <tr>
              <th>Name</th>
              <th>Phone</th>
              <th>Email</th>
              <th>Rentals</th>
            </tr>
          </thead>

          <tbody>

            ${
              data.customers.map(
                c => `
                  <tr>

                    <td>
                      <b>
                        ${esc(c.name)}
                      </b>
                    </td>

                    <td>
                      ${esc(c.phone)}
                    </td>

                    <td>
                      ${esc(
                        c.email || "—"
                      )}
                    </td>

                    <td>
                      ${
                        data.rentals.filter(
                          r =>
                            r.customer_id ===
                            c.id
                        ).length
                      }
                    </td>

                  </tr>
                `
              ).join("")
            }

          </tbody>

        </table>

      </div>

    </section>
  `;
}
async function enablePhoneNotifications() {
  if (!("Notification" in window)) {
    alert("This device does not support notifications.");
    return;
  }

  if (!("serviceWorker" in navigator)) {
    alert("Background notifications are not supported here.");
    return;
  }

  const permission = await Notification.requestPermission();

  if (permission !== "granted") {
    alert("Please allow notifications for ImagineIt.");
    return;
  }

  const registration = await navigator.serviceWorker.ready;

  await registration.showNotification("ImagineIt 🔔", {
    body: "Phone notifications are now enabled!",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png"
  });

  alert("Notifications are ON! 🔔");
}

async function setupPushNotifications() {
  try {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      alert("Push notifications are not supported on this device.");
      return;
    }

    const permission = await Notification.requestPermission();

    if (permission !== "granted") {
      alert("Please allow notifications for ImagineIt.");
      return;
    }

    const registration = await navigator.serviceWorker.ready;

    let subscription = await registration.pushManager.getSubscription();

    if (!subscription) {
      const vapidKey = window.IMAGINEIT_CONFIG.VAPID_PUBLIC_KEY;

      if (!vapidKey) {
        alert("Notification key is missing.");
        return;
      }

      const padding = "=".repeat((4 - (vapidKey.length % 4)) % 4);
      const base64 = (vapidKey + padding)
        .replace(/-/g, "+")
        .replace(/_/g, "/");

      const rawData = window.atob(base64);
      const keyData = new Uint8Array(rawData.length);

      for (let i = 0; i < rawData.length; i++) {
        keyData[i] = rawData.charCodeAt(i);
      }

      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: keyData
      });
    }

    const subscriptionJson = subscription.toJSON();

    const { data: sessionData } =
      await window.supabaseClient.auth.getSession();

    const user = sessionData?.session?.user;

    if (!user) {
      alert("Please log in first.");
      return;
    }

    const { error } = await window.supabaseClient
      .from("push_subscriptions")
      .upsert({
        user_id: user.id,
        endpoint: subscriptionJson.endpoint,
        p256dh: subscriptionJson.keys.p256dh,
        auth: subscriptionJson.keys.auth,
        updated_at: new Date().toISOString()
      }, {
        onConflict: "endpoint"
      });

    if (error) {
      console.error("Subscription save error:", error);
      alert("Could not save your phone notification settings.");
      return;
    }

    alert("🔔 ImagineIt phone notifications are ON!");
    console.log("Phone notification subscription saved.");

  } catch (error) {
    console.error("Push notification setup failed:", error);
    alert("Could not enable notifications.");
  }
}boot();console.log("3 - about to boot");
boot();
console.log("4 - boot called");