class HttpError extends Error {
    constructor(message, statusCode) {
        super(message);
        this.name = 'HTTP_ERROR';
        this.statusCode = statusCode;
    }
}

class HttpBadRequestError extends HttpError {
  constructor(message) {
    super(message, 400);
    this.name = 'BAD_REQUEST';
  }
}

class HttpUnauthorizedError extends HttpError {
  constructor(message) {
    super(message, 401);
    this.name = 'UNAUTHORIZED';
  }
}

class HttpNotFoundError extends HttpError {
  constructor(message) {
    super(message, 404);
    this.name = 'NOT_FOUND';
  }
}

module.exports = {
  HttpError,
  HttpBadRequestError,
  HttpUnauthorizedError,
  HttpNotFoundError
};