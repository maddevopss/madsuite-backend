const express = require("express");
const request = require("supertest");

jest.mock("../middleware/organization.middleware", () => ({
  requireOrganisation: (req, res, next) => next(),
}));

jest.mock("../middleware/requireRole", () => () => (req, res, next) => {
  if (req.headers["x-test-role"] !== "admin") {
    return res.status(403).json({ success: false, code: "FORBIDDEN" });
  }
  req.user = { id: 91 };
  return next();
});

jest.mock("../utils/organisationScope", () => ({
  getOrganisationId: () => 77,
}));

jest.mock("../services/customerGrowth/activities.service", () => ({
  createActivity: jest.fn(),
  deleteActivity: jest.fn(),
  getActivityById: jest.fn(),
  listActivities: jest.fn(),
  updateActivity: jest.fn(),
}));

const activitiesService = require("../services/customerGrowth/activities.service");
const activitiesRouter = require("../routes/customerGrowth/activities.routes");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/activities", activitiesRouter);
  app.use((error, req, res, next) => {
    void next;
    return res.status(500).json({ message: error.message });
  });
  return app;
}

describe("customer growth activities routes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("liste avec l'organisation provenant du contexte et les filtres validés", async () => {
    activitiesService.listActivities.mockResolvedValue([{ id: 4 }]);

    const response = await request(buildApp())
      .get("/activities?lead_id=12&activity_type=call&limit=20&offset=2");

    expect(response.status).toBe(200);
    expect(activitiesService.listActivities).toHaveBeenCalledWith({
      organisationId: 77,
      leadId: 12,
      opportunityId: undefined,
      activityType: "call",
      taskStatus: undefined,
      limit: 20,
      offset: 2,
    });
  });

  test("refuse les champs de requête inconnus avant le service", async () => {
    const response = await request(buildApp()).get("/activities?organisation_id=999");

    expect(response.status).toBe(400);
    expect(activitiesService.listActivities).not.toHaveBeenCalled();
  });

  test("refuse de combiner les filtres prospect et opportunité", async () => {
    const response = await request(buildApp()).get("/activities?lead_id=1&opportunity_id=2");

    expect(response.status).toBe(400);
    expect(activitiesService.listActivities).not.toHaveBeenCalled();
  });

  test("refuse une écriture sans rôle admin avant le service", async () => {
    const response = await request(buildApp())
      .post("/activities")
      .send({ lead_id: 1, activity_type: "call", subject: "Appel" });

    expect(response.status).toBe(403);
    expect(activitiesService.createActivity).not.toHaveBeenCalled();
  });

  test("refuse une création avec deux parents avant le service", async () => {
    const response = await request(buildApp())
      .post("/activities")
      .set("x-test-role", "admin")
      .send({ lead_id: 1, opportunity_id: 2, activity_type: "call", subject: "Appel" });

    expect(response.status).toBe(400);
    expect(activitiesService.createActivity).not.toHaveBeenCalled();
  });

  test("crée une activité avec l'organisation et l'auteur du contexte", async () => {
    activitiesService.createActivity.mockResolvedValue({ id: 8, subject: "Suivi" });

    const response = await request(buildApp())
      .post("/activities")
      .set("x-test-role", "admin")
      .send({ opportunity_id: 5, activity_type: "task", subject: "Suivi", task_status: "pending" });

    expect(response.status).toBe(201);
    expect(activitiesService.createActivity).toHaveBeenCalledWith({
      data: {
        opportunity_id: 5,
        activity_type: "task",
        subject: "Suivi",
        task_status: "pending",
      },
      organisationId: 77,
      actorUserId: 91,
    });
  });

  test("retourne 404 lorsque l'activité demandée n'existe pas", async () => {
    activitiesService.getActivityById.mockResolvedValue(null);

    const response = await request(buildApp()).get("/activities/44");

    expect(response.status).toBe(404);
    expect(activitiesService.getActivityById).toHaveBeenCalledWith({ activityId: 44, organisationId: 77 });
  });

  test("refuse une mise à jour vide avant le service", async () => {
    const response = await request(buildApp())
      .patch("/activities/4")
      .set("x-test-role", "admin")
      .send({});

    expect(response.status).toBe(400);
    expect(activitiesService.updateActivity).not.toHaveBeenCalled();
  });

  test("supprime logiquement l'activité par son identifiant validé", async () => {
    activitiesService.deleteActivity.mockResolvedValue({ id: 6 });

    const response = await request(buildApp())
      .delete("/activities/6")
      .set("x-test-role", "admin");

    expect(response.status).toBe(200);
    expect(activitiesService.deleteActivity).toHaveBeenCalledWith({ activityId: 6, organisationId: 77 });
  });
});
