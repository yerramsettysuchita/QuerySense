import sys, os, random
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import create_engine, text
from datetime import datetime, timedelta

try:
    from faker import Faker
except ImportError:
    os.system("pip install faker")
    from faker import Faker

fake = Faker()
MAIN_DB_URL = os.getenv("MAIN_DB_URL", "postgresql://postgres:postgres@localhost:5432/querysense_main")
engine = create_engine(MAIN_DB_URL)


def is_already_seeded(conn) -> bool:
    result = conn.execute(text("SELECT COUNT(*) FROM users")).scalar()
    return result > 0


def seed():
    with engine.begin() as conn:
        if is_already_seeded(conn):
            print("Database already seeded — skipping. Use --force to re-seed.")
            return

        print("Seeding users (10,000)...")
        users = [{"email": fake.unique.email(), "name": fake.name()} for _ in range(10000)]
        conn.execute(text("TRUNCATE users, products, orders, order_items RESTART IDENTITY CASCADE"))
        conn.execute(text("INSERT INTO users (email, name) VALUES (:email, :name)"), users)

        print("Seeding products (5,000)...")
        categories = ["Electronics", "Clothing", "Books", "Food", "Sports"]
        products = [
            {
                "name": fake.catch_phrase()[:255],
                "category": random.choice(categories),
                "price": round(random.uniform(9.99, 999.99), 2),
                "stock": random.randint(0, 500),
            }
            for _ in range(5000)
        ]
        conn.execute(
            text("INSERT INTO products (name, category, price, stock) VALUES (:name, :category, :price, :stock)"),
            products,
        )

        print("Seeding orders (50,000)...")
        orders = []
        for _ in range(50000):
            days_ago = random.randint(0, 365)
            created = datetime.now() - timedelta(days=days_ago)
            orders.append({
                "user_id": random.randint(1, 10000),
                "total": round(random.uniform(20.0, 2000.0), 2),
                "status": random.choice(["pending", "completed", "cancelled"]),
                "created_at": created,
            })

        conn.execute(
            text("INSERT INTO orders (user_id, total, status, created_at) VALUES (:user_id, :total, :status, :created_at)"),
            orders,
        )

        print("Seeding order_items (150,000)...")
        items = []
        for order_id in range(1, 50001):
            for _ in range(random.randint(1, 4)):
                items.append({
                    "order_id": order_id,
                    "product_id": random.randint(1, 5000),
                    "quantity": random.randint(1, 10),
                    "price": round(random.uniform(9.99, 999.99), 2),
                })

        batch_size = 5000
        for i in range(0, len(items), batch_size):
            conn.execute(
                text("INSERT INTO order_items (order_id, product_id, quantity, price) VALUES (:order_id, :product_id, :quantity, :price)"),
                items[i:i + batch_size],
            )
            print(f"  items: {min(i + batch_size, len(items))}/{len(items)}")

    print("\nDone. DB is loaded and intentionally missing indexes — ready for QuerySense to find them.")


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true", help="Truncate and re-seed even if data exists")
    args = parser.parse_args()
    if args.force:
        with engine.begin() as conn:
            conn.execute(text("TRUNCATE users, products, orders, order_items RESTART IDENTITY CASCADE"))
            print("Truncated existing data.")
    seed()
