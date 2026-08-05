/**
 * Issue #174 PR A: Authorization Middleware
 *
 * Middleware to enforce route permissions on incoming requests
 */

const authService = require("../services/authorizationService");

/**
 * Authorization middleware factory
 */
function requirePermission(requiredPermissionName) {
  return async (req, res, next) => {
    try {
      // Get user info from auth context
      const userId = req.user?.id;
      const organizationId = req.user?.organizationId || req.query.organizationId;

      if (!userId || !organizationId) {
        return res.status(401).json({
          error: "Unauthorized",
          reason: "user_not_authenticated"
        });
      }

      // Check route permission
      const permission = await authService.checkRoutePermission(
        userId,
        organizationId,
        req.method,
        req.baseUrl + req.path
      );

      if (!permission.permitted) {
        return res.status(403).json({
          error: "Forbidden",
          reason: permission.reason,
          message: `Permission denied: ${permission.reason}`
        });
      }

      // Attach authorization info to request
      req.authorization = {
        permitted: true,
        permission: permission.permission,
        is_sensitive: permission.is_sensitive,
        requires_approval: permission.requires_approval
      };

      next();
    } catch (error) {
      console.error("Authorization middleware error:", error);
      res.status(500).json({
        error: "Internal Server Error",
        message: "Authorization check failed"
      });
    }
  };
}

/**
 * Check if route requires sensitive operation protections
 */
function requireSensitiveProtection(req, res, next) {
  if (req.authorization?.is_sensitive) {
    // Add replay protection check
    const replayToken = req.headers["x-operation-token"];
    if (!replayToken) {
      return res.status(400).json({
        error: "Bad Request",
        reason: "missing_operation_token",
        message: "Sensitive operations require operation token for replay protection"
      });
    }
  }
  next();
}

/**
 * Check if operation requires approval
 */
function requireApproval(req, res, next) {
  if (req.authorization?.requires_approval) {
    const approverToken = req.headers["x-approval-token"];
    if (!approverToken) {
      return res.status(400).json({
        error: "Bad Request",
        reason: "missing_approval_token",
        message: "Operation requires explicit approval"
      });
    }
  }
  next();
}

/**
 * Compose authorization middleware chain
 */
function authorize(...requiredPermissions) {
  return async (req, res, next) => {
    try {
      const userId = req.user?.id;
      const organizationId = req.user?.organizationId || req.query.organizationId;

      if (!userId || !organizationId) {
        return res.status(401).json({
          error: "Unauthorized",
          reason: "user_not_authenticated"
        });
      }

      // Check all required permissions
      for (const permission of requiredPermissions) {
        const result = await authService.checkRoutePermission(
          userId,
          organizationId,
          req.method,
          req.baseUrl + req.path
        );

        if (!result.permitted) {
          return res.status(403).json({
            error: "Forbidden",
            reason: result.reason
          });
        }
      }

      next();
    } catch (error) {
      console.error("Authorization error:", error);
      res.status(500).json({
        error: "Internal Server Error"
      });
    }
  };
}

module.exports = {
  requirePermission,
  requireSensitiveProtection,
  requireApproval,
  authorize
};
