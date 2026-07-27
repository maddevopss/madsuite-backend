jest.mock("../../../db", () => ({ connect: jest.fn() }));
jest.mock("../services/business/inventory-transaction.service", () => ({ postInventoryTransaction: jest.fn() }));

const pool = require("../../../db");
const inventoryTransactionService = require("../services/business/inventory-transaction.service");
const service = require("../services/business/inventory-procurement.service");

function clientWith(responses) {
  return {
    query: jest.fn(async () => responses.shift() || { rows: [], rowCount: 0 }),
    release: jest.fn(),
  };
}

describe("inventory procurement contract", () => {
  beforeEach(() => jest.clearAllMocks());

  test("refuse une commande sans ligne", async () => {
    await expect(service.createPurchaseOrder({
      organisationId: 1,
      actorUserId: 7,
      supplierId: 4,
      purchaseOrderNumber: "PO-1",
      lines: [],
      idempotencyKey: "purchase-order-1",
    })).rejects.toMatchObject({ statusCode: 400 });
  });

  test("crée une commande et calcule les totaux côté serveur", async () => {
    const client = clientWith([
      {}, {},
      { rows: [] },
      { rows: [{ id: 4 }], rowCount: 1 },
      { rows: [{ id: 11 }], rowCount: 1 },
      { rows: [{ id: 20, purchase_order_number: "PO-20", status: "draft" }] },
      { rows: [{ id: 31, ordered_quantity: "2.000", unit_cost: "15.0000" }] },
      {},
    ]);
    pool.connect.mockResolvedValue(client);

    const result = await service.createPurchaseOrder({
      organisationId: 1,
      actorUserId: 7,
      supplierId: 4,
      purchaseOrderNumber: "PO-20",
      currency: "CAD",
      lines: [{ inventoryItemId: 11, description: "Pièce", quantity: 2, unitCost: 15, taxRate: 0.14975 }],
      idempotencyKey: "purchase-order-20",
    });

    expect(result.purchaseOrder.id).toBe(20);
    const insertOrder = client.query.mock.calls.find(([sql]) => sql.includes("INSERT INTO procurement_purchase_orders"));
    expect(insertOrder[1][4]).toBe("30.00");
    expect(insertOrder[1][5]).toBe("4.49");
    expect(insertOrder[1][6]).toBe("34.49");
  });

  test("rend la création de commande idempotente", async () => {
    const client = clientWith([
      {}, {},
      { rows: [{ id: 20, idempotency_key: "purchase-order-20" }] },
      {},
    ]);
    pool.connect.mockResolvedValue(client);

    const result = await service.createPurchaseOrder({
      organisationId: 1,
      supplierId: 4,
      purchaseOrderNumber: "PO-20",
      lines: [{ inventoryItemId: 11, description: "Pièce", quantity: 2, unitCost: 15 }],
      idempotencyKey: "purchase-order-20",
    });

    expect(result.duplicate).toBe(true);
  });

  test("refuse une réception supérieure au solde commandé", async () => {
    const client = clientWith([
      {}, {},
      { rows: [] },
      { rows: [{ id: 20, status: "approved" }] },
      { rows: [{ id: 44, receipt_number: "REC-44" }] },
      { rows: [{ id: 31, ordered_quantity: "5.000", received_quantity: "4.000", unit_cost: "10.0000", inventory_item_id: 11 }] },
    ]);
    pool.connect.mockResolvedValue(client);

    await expect(service.receivePurchaseOrder({
      organisationId: 1,
      purchaseOrderId: 20,
      actorUserId: 7,
      receiptNumber: "REC-44",
      idempotencyKey: "receipt-order-20",
      lines: [{ purchaseOrderLineId: 31, locationId: 3, quantity: 2 }],
    })).rejects.toMatchObject({ statusCode: 409 });
  });

  test("transforme la quantité acceptée en mouvement d'inventaire", async () => {
    const firstClient = clientWith([
      {}, {},
      { rows: [] },
      { rows: [{ id: 20, status: "approved" }] },
      { rows: [{ id: 44, receipt_number: "REC-44" }] },
      { rows: [{ id: 31, ordered_quantity: "5.000", received_quantity: "0.000", unit_cost: "10.0000", inventory_item_id: 11 }] },
      {}, {}, {},
    ]);
    const secondClient = clientWith([
      {},
      { rows: [{ pending: 1 }] },
      {}, {}, {},
    ]);
    pool.connect.mockResolvedValueOnce(firstClient).mockResolvedValueOnce(secondClient);
    inventoryTransactionService.postInventoryTransaction.mockResolvedValue({ inventoryTransaction: { id: 99 } });

    const result = await service.receivePurchaseOrder({
      organisationId: 1,
      purchaseOrderId: 20,
      actorUserId: 7,
      receiptNumber: "REC-44",
      idempotencyKey: "receipt-order-20",
      lines: [{ purchaseOrderLineId: 31, locationId: 3, quantity: 5, rejectedQuantity: 1 }],
    });

    expect(result.duplicate).toBe(false);
    expect(inventoryTransactionService.postInventoryTransaction).toHaveBeenCalledWith(expect.objectContaining({
      type: "receipt",
      itemId: 11,
      locationId: 3,
      quantity: 4,
      referenceType: "procurement_receipt",
    }));
  });
});
