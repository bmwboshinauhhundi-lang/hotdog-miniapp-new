
import { useEffect, useState } from "react";
import {
  collection,
  getDocs,
  doc,
  setDoc,
  addDoc,
  serverTimestamp,
 } from "firebase/firestore";
import { db } from "./firebase/config";
import "./App.css";

function App() {
  const [telegramUser, setTelegramUser] = useState(null);
  const [products, setProducts] = useState([]);
  const [cart, setCart] = useState([]);

  const [loading, setLoading] = useState(true);
  const [productsError, setProductsError] = useState("");
  const [orderLoading, setOrderLoading] = useState(false);

  const [showCart, setShowCart] = useState(false);
  const [showCheckout, setShowCheckout] = useState(false);

  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [location, setLocation] = useState(null);

  const [checkoutError, setCheckoutError] = useState("");
  const [orderSuccess, setOrderSuccess] = useState(null);

  // =========================
  // TELEGRAM
  // =========================

  useEffect(() => {
    const tg = window.Telegram?.WebApp;

    if (!tg) {
      console.warn("Telegram WebApp topilmadi");
      return;
    }

    tg.ready();
    tg.expand();

    const user = tg.initDataUnsafe?.user;

    if (user) {
      setTelegramUser(user);
    } else {
      console.warn("Telegram foydalanuvchisi topilmadi");
    }
  }, []);

  // =========================
  // PRODUCTS
  // =========================

  // =========================
  // PRODUCTS
  // =========================

  const loadProducts = async () => {
    setProductsError("");

    try {
      // Firestore'dagi hozirgi struktura:
      // products/{productId}
      // name, description, price, image_file_id, active, created_at, created_by
      //
      // active=false bo'lgan mahsulotlarni menyuda ko'rsatmaymiz.
      // active maydoni eski mahsulotlarda bo'lmasa, ular ham ko'rsatiladi.
      const snapshot = await getDocs(collection(db, "products"));

      const productsData = snapshot.docs
        .map((item) => {
          const data = item.data() || {};

          return {
            id: item.id,
            name: data.name || "",
            description: data.description || "",
            price: Number(data.price || 0),
            active: data.active !== false,
            image_file_id: data.image_file_id || "",
            // Agar keyinchalik bot web URL saqlasa, frontend uni ham ishlatadi.
            image:
              data.image ||
              data.image_url ||
              data.imageUrl ||
              "",
            created_at: data.created_at || null,
            created_by: data.created_by || null,
          };
        })
        .filter((product) => product.active);

      // Yangi mahsulotlar birinchi ko'rinishi uchun created_at bo'yicha
      // client tomonda xavfsiz tartiblaymiz. Timestamp bo'lmasa oxirida qoladi.
      productsData.sort((a, b) => {
        const aTime = a.created_at?.toMillis?.() || 0;
        const bTime = b.created_at?.toMillis?.() || 0;
        return bTime - aTime;
      });

      setProducts(productsData);
    } catch (error) {
      console.error("Mahsulotlarni yuklashda xato:", error);

      let message = "Mahsulotlarni yuklashda xatolik yuz berdi.";

      if (error?.code === "permission-denied") {
        message =
          "Firestore mahsulotlarni o'qishga ruxsat bermadi. Security Rules'ni tekshiring.";
      } else if (error?.code === "failed-precondition") {
        message =
          "Firebase konfiguratsiyasi yoki Firestore indeksi bilan bog'liq xatolik.";
      } else if (error?.message) {
        message = `Mahsulotlarni yuklashda xato: ${error.message}`;
      }

      setProductsError(message);
      setProducts([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProducts();
  }, []);

  // =========================
  // CART
  // =========================

  const addToCart = (product) => {
    setCart((currentCart) => {
      const existing = currentCart.find(
        (item) => item.id === product.id
      );

      if (existing) {
        return currentCart.map((item) =>
          item.id === product.id
            ? {
                ...item,
                quantity: item.quantity + 1,
              }
            : item
        );
      }

      return [
        ...currentCart,
        {
          ...product,
          quantity: 1,
        },
      ];
    });
  };

  const increaseQuantity = (productId) => {
    setCart((currentCart) =>
      currentCart.map((item) =>
        item.id === productId
          ? {
              ...item,
              quantity: item.quantity + 1,
            }
          : item
      )
    );
  };

  const decreaseQuantity = (productId) => {
    setCart((currentCart) =>
      currentCart
        .map((item) =>
          item.id === productId
            ? {
                ...item,
                quantity: item.quantity - 1,
              }
            : item
        )
        .filter((item) => item.quantity > 0)
    );
  };

  const clearCart = () => {
    setCart([]);
  };

  // =========================
  // TOTAL
  // =========================

  const cartCount = cart.reduce(
    (total, item) =>
      total + Number(item.quantity || 0),
    0
  );

  const cartTotal = cart.reduce(
    (total, item) =>
      total +
      Number(item.price || 0) *
        Number(item.quantity || 0),
    0
  );

  // =========================
  // PRICE
  // =========================

  const formatPrice = (price) => {
    return `${Number(price || 0).toLocaleString("ru-RU")} so'm`;
  };

  // =========================
  // LOCATION
  // =========================

  const getLocation = () => {
    setCheckoutError("");

    if (!navigator.geolocation) {
      setCheckoutError(
        "Brauzeringiz geolokatsiyani qo‘llab-quvvatlamaydi."
      );
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocation({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
      },
      (error) => {
        console.error("Geolokatsiya xatosi:", error);

        setCheckoutError(
          "Geolokatsiyani olish imkoni bo‘lmadi. Joylashuvga ruxsat bering."
        );
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      }
    );
  };

  // =========================
  // ORDER
  // =========================

  const handleOrder = async (event) => {
    event.preventDefault();

    setCheckoutError("");

    if (!telegramUser) {
      setCheckoutError(
        "Iltimos, Mini App'ni Telegram orqali oching."
      );
      return;
    }

    if (cart.length === 0) {
      setCheckoutError("Savat bo‘sh.");
      return;
    }

    const cleanPhone = phone.trim();
    const cleanAddress = address.trim();

    if (!cleanPhone) {
      setCheckoutError("Telefon raqamingizni kiriting.");
      return;
    }

    if (!cleanAddress) {
      setCheckoutError("Yetkazib berish manzilini kiriting.");
      return;
    }

    setOrderLoading(true);

    try {
      // =========================
      // USER
      // =========================

      const userRef = doc(
        db,
        "users",
        String(telegramUser.id)
      );

      await setDoc(
        userRef,
        {
          telegramId: telegramUser.id,
          firstName: telegramUser.first_name || "",
          lastName: telegramUser.last_name || "",
          username: telegramUser.username || "",
          phone: cleanPhone,
          updatedAt: serverTimestamp(),
        },
        {
          merge: true,
        }
      );

      // =========================
      // ITEMS
      // =========================

      const orderItems = cart.map((item) => ({
        productId: item.id,
        name: item.name || "Mahsulot",
        price: Number(item.price || 0),
        quantity: Number(item.quantity || 1),
      }));

      // =========================
      // CUSTOMER
      // =========================

      const customerName = [
        telegramUser.first_name || "",
        telegramUser.last_name || "",
      ]
        .filter(Boolean)
        .join(" ")
        .trim();

      // =========================
      // ORDER
      // =========================

      const orderData = {
        customerName,

        phone: cleanPhone,

        address: cleanAddress,

        location: location
          ? {
              latitude: Number(location.latitude),
              longitude: Number(location.longitude),
            }
          : null,

        items: orderItems,

        totalPrice: Number(cartTotal),

        telegramId: telegramUser.id,

        userId: String(telegramUser.id),

        orderStatus: "pending",

        paymentStatus: "pending",

        createdAt: serverTimestamp(),
      };

      const orderRef = await addDoc(
        collection(db, "orders"),
        orderData
      );

      console.log("Buyurtma yaratildi:", orderRef.id);

      // =========================
      // SUCCESS
      // =========================

      setOrderSuccess({
        orderId: orderRef.id,
        totalPrice: cartTotal,
      });

      clearCart();

      setShowCheckout(false);
      setShowCart(false);

      setAddress("");
      setLocation(null);
    } catch (error) {
      console.error("Buyurtma yaratishda xato:", error);

      if (error.code === "permission-denied") {
        setCheckoutError(
          "Buyurtma yuborilmadi. Firebase Security Rules'ni tekshiring."
        );
      } else {
        setCheckoutError(
          "Buyurtmani rasmiylashtirishda xatolik yuz berdi. Qaytadan urinib ko‘ring."
        );
      }
    } finally {
      setOrderLoading(false);
    }
  };

  // =========================
  // CHECKOUT
  // =========================

  const openCheckout = () => {
    if (cart.length === 0) return;

    setCheckoutError("");
    setShowCheckout(true);
  };

  // =========================
  // LOADING
  // =========================

  if (loading) {
    return (
      <div className="loading">
        <div className="loading-icon">
          🌭
        </div>

        <p>Menyu yuklanmoqda...</p>
      </div>
    );
  }

  // =========================
  // SUCCESS
  // =========================

  if (orderSuccess) {
    return (
      <div className="app">
        <div className="empty-cart">
          <div>✅</div>

          <h2>Buyurtma qabul qilindi!</h2>

          <p>
            Rahmat
            {telegramUser?.first_name
              ? `, ${telegramUser.first_name}`
              : ""}
            !
          </p>

          <div
            style={{
              marginTop: "18px",
              color: "#777",
              fontSize: "13px",
            }}
          >
            Buyurtma raqami:
          </div>

          <strong
            style={{
              display: "block",
              marginTop: "5px",
              fontSize: "18px",
            }}
          >
            #{orderSuccess.orderId.slice(-6)}
          </strong>

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginTop: "18px",
              padding: "15px",
              background: "#f7f7f7",
              borderRadius: "15px",
            }}
          >
            <span>Jami:</span>

            <strong>
              {formatPrice(
                orderSuccess.totalPrice
              )}
            </strong>
          </div>

          <button
            type="button"
            className="checkout-button"
            onClick={() =>
              setOrderSuccess(null)
            }
          >
            Menyuga qaytish
          </button>
        </div>
      </div>
    );
  }

  // =========================
  // MAIN APP
  // =========================

  return (
    <div className="app">

      {/* HEADER */}

      <header className="header">
        <div className="logo">
          🌭
        </div>

        <div>
          <h1>Hot Dog</h1>

          <p>
            {telegramUser
              ? `Salom, ${
                  telegramUser.first_name || "mehmon"
                }!`
              : "Xush kelibsiz!"}
          </p>
        </div>
      </header>

      {/* USER */}

      {telegramUser ? (
        <div className="user-info">
          <div className="user-avatar">
            {(
              telegramUser.first_name || "U"
            )
              .charAt(0)
              .toUpperCase()}
          </div>

          <div>
            <strong>
              {telegramUser.first_name ||
                "Foydalanuvchi"}

              {telegramUser.last_name
                ? ` ${telegramUser.last_name}`
                : ""}
            </strong>

            <span>
              {telegramUser.username
                ? `@${telegramUser.username}`
                : `ID: ${telegramUser.id}`}
            </span>
          </div>
        </div>
      ) : (
        <div className="user-info">
          <div className="user-avatar">
            👤
          </div>

          <div>
            <strong>Mehmon</strong>

            <span>
              Ilovani Telegram orqali oching
            </span>
          </div>
        </div>
      )}

      {/* SECTION */}

      <div className="section-title">
        <h2>Menyu</h2>

        <span>
          {products.length} ta mahsulot
        </span>
      </div>

      {productsError && (
        <div
          style={{
            padding: "14px",
            marginBottom: "14px",
            background: "#ffe5e5",
            color: "#c62828",
            borderRadius: "14px",
            fontSize: "13px",
            lineHeight: 1.45,
          }}
        >
          <div>{productsError}</div>

          <button
            type="button"
            className="add-button"
            onClick={() => {
              setLoading(true);
              loadProducts();
            }}
            style={{ marginTop: "10px" }}
          >
            Qayta yuklash
          </button>
        </div>
      )}

      {/* PRODUCTS */}

      <main className="products">
        {products.length === 0 ? (
          <div className="empty-cart">
            <div>🍔</div>

            <p>
              Hozircha mahsulotlar yo‘q.
            </p>
          </div>
        ) : (
          products.map((product) => {
            const cartItem = cart.find(
              (item) => item.id === product.id
            );

            return (
              <article
                className="product-card"
                key={product.id}
              >
                <div className="product-image">
                  {product.image ? (
                    <img
                      src={product.image}
                      alt={product.name || "Mahsulot"}
                      onError={(event) => {
                        event.currentTarget.style.display = "none";
                      }}
                    />
                  ) : (
                    "🌭"
                  )}
                </div>

                <div className="product-content">
                  <h2>
                    {product.name ||
                      "Nomsiz mahsulot"}
                  </h2>

                  <p>
                    {product.description ||
                      "Mazali hot-dog"}
                  </p>

                  <div className="product-bottom">
                    <strong>
                      {formatPrice(
                        product.price
                      )}
                    </strong>

                    {cartItem ? (
                      <div className="quantity-control">
                        <button
                          type="button"
                          onClick={() =>
                            decreaseQuantity(
                              product.id
                            )
                          }
                        >
                          −
                        </button>

                        <span>
                          {cartItem.quantity}
                        </span>

                        <button
                          type="button"
                          onClick={() =>
                            increaseQuantity(
                              product.id
                            )
                          }
                        >
                          +
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="add-button"
                        onClick={() =>
                          addToCart(product)
                        }
                      >
                        Qo‘shish
                      </button>
                    )}
                  </div>
                </div>
              </article>
            );
          })
        )}
      </main>

      {/* CART BAR */}

      {cart.length > 0 && (
        <button
          type="button"
          className="cart-bar"
          onClick={() =>
            setShowCart(true)
          }
        >
          <div>
            <span className="cart-count">
              {cartCount}
            </span>

            <strong>
              Savatni ochish
            </strong>
          </div>

          <strong>
            {formatPrice(cartTotal)}
          </strong>
        </button>
      )}

      {/* CART */}

      {showCart && (
        <div
          className="cart-overlay"
          onClick={() =>
            setShowCart(false)
          }
        >
          <div
            className="cart-sheet"
            onClick={(event) =>
              event.stopPropagation()
            }
          >
            <div className="cart-header">
              <h2>Savat</h2>

              <button
                type="button"
                className="close-cart"
                onClick={() =>
                  setShowCart(false)
                }
              >
                ×
              </button>
            </div>

            {cart.length === 0 ? (
              <div className="empty-cart">
                <div>🛒</div>

                <p>Savat bo‘sh</p>
              </div>
            ) : (
              <>
                <div className="cart-items">
                  {cart.map((item) => (
                    <div
                      className="cart-item"
                      key={item.id}
                    >
                      <div className="cart-item-image">
                        {item.image ? (
                          <img
                            src={item.image}
                            alt={item.name || "Mahsulot"}
                            onError={(event) => {
                              event.currentTarget.style.display = "none";
                            }}
                          />
                        ) : (
                          "🌭"
                        )}
                      </div>

                      <div className="cart-item-info">
                        <strong>
                          {item.name}
                        </strong>

                        <span>
                          {formatPrice(
                            item.price
                          )}
                        </span>

                        <div className="cart-quantity">
                          <button
                            type="button"
                            onClick={() =>
                              decreaseQuantity(
                                item.id
                              )
                            }
                          >
                            −
                          </button>

                          <span>
                            {item.quantity}
                          </span>

                          <button
                            type="button"
                            onClick={() =>
                              increaseQuantity(
                                item.id
                              )
                            }
                          >
                            +
                          </button>
                        </div>
                      </div>

                      <strong className="cart-item-total">
                        {formatPrice(
                          Number(
                            item.price || 0
                          ) *
                            Number(
                              item.quantity || 0
                            )
                        )}
                      </strong>
                    </div>
                  ))}
                </div>

                <div className="cart-total">
                  <span>Jami</span>

                  <strong>
                    {formatPrice(cartTotal)}
                  </strong>
                </div>

                <button
                  type="button"
                  className="checkout-button"
                  onClick={openCheckout}
                >
                  Buyurtma berish
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* CHECKOUT */}

      {showCheckout && (
        <div
          className="cart-overlay"
          onClick={() =>
            setShowCheckout(false)
          }
        >
          <div
            className="cart-sheet"
            onClick={(event) =>
              event.stopPropagation()
            }
          >
            <div className="cart-header">
              <h2>Buyurtma berish</h2>

              <button
                type="button"
                className="close-cart"
                onClick={() =>
                  setShowCheckout(false)
                }
              >
                ×
              </button>
            </div>

            {/* USER */}

            {telegramUser && (
              <div className="user-info">
                <div className="user-avatar">
                  {(
                    telegramUser.first_name ||
                    "U"
                  )
                    .charAt(0)
                    .toUpperCase()}
                </div>

                <div>
                  <strong>
                    {telegramUser.first_name ||
                      ""}

                    {telegramUser.last_name
                      ? ` ${telegramUser.last_name}`
                      : ""}
                  </strong>

                  <span>
                    {telegramUser.username
                      ? `@${telegramUser.username}`
                      : `ID: ${telegramUser.id}`}
                  </span>
                </div>
              </div>
            )}

            <form onSubmit={handleOrder}>

              {/* PHONE */}

              <label
                style={{
                  display: "block",
                  marginBottom: "7px",
                  fontSize: "13px",
                  fontWeight: "bold",
                }}
              >
                Telefon raqami
              </label>

              <input
                type="tel"
                value={phone}
                onChange={(event) =>
                  setPhone(
                    event.target.value
                  )
                }
                placeholder="+998 90 123 45 67"
                required
                style={{
                  width: "100%",
                  padding: "13px",
                  border: "1px solid #e5e5e5",
                  borderRadius: "12px",
                  outline: "none",
                  fontFamily: "inherit",
                  fontSize: "14px",
                  marginBottom: "14px",
                }}
              />

              {/* ADDRESS */}

              <label
                style={{
                  display: "block",
                  marginBottom: "7px",
                  fontSize: "13px",
                  fontWeight: "bold",
                }}
              >
                Yetkazib berish manzili
              </label>

              <textarea
                value={address}
                onChange={(event) =>
                  setAddress(
                    event.target.value
                  )
                }
                placeholder="Manzilingizni kiriting"
                rows="3"
                required
                style={{
                  width: "100%",
                  padding: "13px",
                  border: "1px solid #e5e5e5",
                  borderRadius: "12px",
                  outline: "none",
                  resize: "vertical",
                  fontFamily: "inherit",
                  fontSize: "14px",
                  marginBottom: "14px",
                }}
              />

              {/* LOCATION */}

              <div
                style={{
                  padding: "14px",
                  background: "#f7f7f7",
                  borderRadius: "15px",
                  marginBottom: "14px",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent:
                      "space-between",
                    gap: "10px",
                  }}
                >
                  <div>
                    <strong
                      style={{
                        display: "block",
                        fontSize: "14px",
                      }}
                    >
                      📍 Geolokatsiya
                    </strong>

                    <span
                      style={{
                        display: "block",
                        marginTop: "4px",
                        color: "#777",
                        fontSize: "12px",
                      }}
                    >
                      {location
                        ? "Joylashuv olindi"
                        : "Joylashuv olinmagan"}
                    </span>
                  </div>

                  <button
                    type="button"
                    className="add-button"
                    onClick={getLocation}
                  >
                    {location
                      ? "Yangilash"
                      : "Olish"}
                  </button>
                </div>
              </div>

              {/* ERROR */}

              {checkoutError && (
                <div
                  style={{
                    padding: "12px",
                    marginBottom: "14px",
                    borderRadius: "12px",
                    background: "#ffe5e5",
                    color: "#c62828",
                    fontSize: "13px",
                  }}
                >
                  {checkoutError}
                </div>
              )}

              {/* TOTAL */}

              <div className="cart-total">
                <span>To‘lov summasi</span>

                <strong>
                  {formatPrice(cartTotal)}
                </strong>
              </div>

              {/* SUBMIT */}

              <button
                type="submit"
                className="checkout-button"
                disabled={orderLoading}
                style={{
                  opacity: orderLoading
                    ? 0.6
                    : 1,
                }}
              >
                {orderLoading
                  ? "Yuborilmoqda..."
                  : "Buyurtmani tasdiqlash"}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
