const express = require("express");
const ApiResponse = require("../utils/apiResponse");

const { loginSchema, refreshTokenSchema } = require("../validators/auth.validator");
const { handleServiceError } = require("../utils/routeError");
const authService = require("../services/auth.service");
const rateLimiter = require("../middleware/rateLimiter.middleware");

const router = express.Router();

const ACCESS_COOKIE_NAME = "access_token";
const COOKIE_NAME = "refresh_token";

function buildCookieOptions(maxAge) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.REFRESH_COOKIE_SAMESITE || "strict",
    path: "/",
    maxAge,
  };
}

function setAccessCookie(res, token) {
  res.cookie(ACCESS_COOKIE_NAME, token, buildCookieOptions(authService.ACCESS_TOKEN_TTL_MS));
}

function setRefreshCookie(res, token) {
  res.cookie(COOKIE_NAME, token, buildCookieOptions(authService.REFRESH_TOKEN_TTL_MS));
}

function clearAccessCookie(res) {
  res.clearCookie(ACCESS_COOKIE_NAME, { path: "/" });
}

function clearRefreshCookie(res) {
  res.clearCookie(COOKIE_NAME, { path: "/" });
}

function getRefreshTokenFromRequest(req) {
  return req.cookies?.[COOKIE_NAME] || req.body?.refreshToken;
}

// POST /api/login
router.post("/login", rateLimiter, async (req, res, next) => {
  try {
    const parsed = loginSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json(ApiResponse.error("VALIDATION_ERROR", { errors: parsed.error.flatten() }));
    }

    const result = await authService.loginUser({
      email: parsed.data.email,
      password: parsed.data.password,
      req,
    });

    setRefreshCookie(res, result.refreshToken);
    setAccessCookie(res, result.accessToken);

    return res.status(200).json({
      success: true,
      code: "LOGIN_SUCCESS",
      token: result.accessToken,
      expiresIn: authService.ACCESS_TOKEN_EXPIRES_IN,
      refreshTokenExpiresIn: authService.REFRESH_TOKEN_EXPIRES_IN,
      user: result.user,
    });
  } catch (err) {
    return handleServiceError(err, res, next, { success: false });
  }
});

// POST /api/signup
router.post("/signup", rateLimiter, async (req, res, next) => {
  try {
    const { signupSchema } = require("../validators/auth.validator");
    const parsed = signupSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json(ApiResponse.error("VALIDATION_ERROR", { errors: parsed.error.flatten() }));
    }

    const result = await authService.signupUser({
      organisation_nom: parsed.data.organisation_nom,
      user_nom: parsed.data.user_nom,
      email: parsed.data.email,
      password: parsed.data.password,
      req,
    });

    setRefreshCookie(res, result.refreshToken);
    setAccessCookie(res, result.accessToken);

    return res.status(201).json({
      success: true,
      code: "SIGNUP_SUCCESS",
      token: result.accessToken,
      expiresIn: authService.ACCESS_TOKEN_EXPIRES_IN,
      refreshTokenExpiresIn: authService.REFRESH_TOKEN_EXPIRES_IN,
      user: result.user,
    });
  } catch (err) {
    if (err.statusCode === 409) {
      return res.status(409).json(ApiResponse.error("CONFLICT", { message: err.message }));
    }
    return handleServiceError(err, res, next, { success: false });
  }
});

// POST /api/logout
router.post("/logout", async (req, res, next) => {
  const authHeader = req.headers.authorization;
  const refreshToken = getRefreshTokenFromRequest(req);

  if (!authHeader?.startsWith("Bearer ") && !refreshToken) {
    clearRefreshCookie(res);
    return res.status(401).json(ApiResponse.error("TOKEN_MISSING", { message: "Token manquant" }));
  }

  const token = authHeader?.startsWith("Bearer ") ? authHeader.split(" ")[1] : null;

  try {
    await authService.logoutSession({ token, refreshToken });

    clearAccessCookie(res);
    clearRefreshCookie(res);

    return res.status(200).json({ success: true });
  } catch (err) {
    clearAccessCookie(res);
    clearRefreshCookie(res);
    return handleServiceError(err, res, next, { success: false });
  }
});

// POST /api/refresh
router.post("/refresh", async (req, res, next) => {
  try {
    const refreshToken = getRefreshTokenFromRequest(req);

    const parsed = refreshTokenSchema.safeParse({ refreshToken });

    if (!parsed.success) {
      return res.status(400).json(ApiResponse.error("VALIDATION_ERROR", { errors: parsed.error.flatten() }));
    }

    const result = await authService.refreshSession({
      refreshToken: parsed.data.refreshToken,
      req,
    });

    setRefreshCookie(res, result.refreshToken);
    setAccessCookie(res, result.accessToken);

    return res.status(200).json({
      success: true,
      code: "REFRESH_SUCCESS",
      token: result.accessToken,
      expiresIn: authService.ACCESS_TOKEN_EXPIRES_IN,
      refreshTokenExpiresIn: authService.REFRESH_TOKEN_EXPIRES_IN,
      user: result.user,
    });
  } catch (err) {
    clearAccessCookie(res);
    clearRefreshCookie(res);
    return handleServiceError(err, res, next, { success: false });
  }
});

module.exports = router;
