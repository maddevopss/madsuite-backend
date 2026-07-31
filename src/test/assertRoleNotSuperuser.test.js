const db = require("../../db");
const { assertRoleNotSuperuser } = require("../../db");

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

describe("P0 - assertRoleNotSuperuser guard", () => {
  let originalNodeEnv;

  beforeEach(() => {
    originalNodeEnv = process.env.NODE_ENV;
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    jest.restoreAllMocks();
  });

  test("should allow normal (non-superuser) role to pass", async () => {
    const connection = await db.pool.connect();
    const roleName = `madproof_normal_${Date.now()}_${Math.floor(Math.random() * 100000)}`;

    try {
      await connection.query("BEGIN");
      const quotedRole = quoteIdentifier(roleName);
      await connection.query(
        `CREATE ROLE ${quotedRole} NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`,
      );

      const roleCheck = await connection.query(
        "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = $1",
        [roleName],
      );
      expect(roleCheck.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });

      await expect(assertRoleNotSuperuser(connection)).resolves.toBeUndefined();

      await connection.query("ROLLBACK");
    } finally {
      connection.release();
    }
  }, 30000);

  test("should detect the current role privileges", async () => {
    const connection = await db.pool.connect();

    try {
      const result = await connection.query(
        "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user",
      );

      if (process.env.NODE_ENV === "test") {
        expect(result.rows[0].rolsuper).toBe(true);
      }
    } finally {
      connection.release();
    }
  }, 30000);

  test("should skip check in test environment", async () => {
    expect(process.env.NODE_ENV).toBe("test");
    await expect(assertRoleNotSuperuser(db.pool)).resolves.toBeUndefined();
  });

  test("should block startup for unsafe roles before returning", async () => {
    process.env.NODE_ENV = "production";
    jest.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit should not be called by assertRoleNotSuperuser");
    });

    const unsafePool = {
      query: jest.fn().mockResolvedValue({
        rows: [
          {
            rolname: "postgres",
            rolsuper: true,
            rolbypassrls: false,
          },
        ],
      }),
    };

    await expect(assertRoleNotSuperuser(unsafePool)).rejects.toThrow(
      "Unsafe database role: SUPERUSER",
    );
    expect(process.exit).not.toHaveBeenCalled();
  });
});
