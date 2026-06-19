/**
 * Wrapper standardise pour toutes les reponses API.
 * Garantit un format coherent: { success, code, data, timestamp, errors }.
 */
class ApiResponse {
  constructor(success = true, code = "OK", data = null, errors = null) {
    this.success = success;
    this.code = code;
    this.data = data;
    this.timestamp = new Date().toISOString();
    if (errors) this.errors = errors;
  }

  static success(code, data = null) {
    return new ApiResponse(true, code, data);
  }

  static error(code, errors = null) {
    return new ApiResponse(false, code, null, errors);
  }

  toJSON() {
    const obj = {
      success: this.success,
      code: this.code,
      data: this.data,
      timestamp: this.timestamp,
    };
    if (this.errors) obj.errors = this.errors;
    return obj;
  }
}

module.exports = ApiResponse;
