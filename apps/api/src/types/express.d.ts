declare global {
  namespace Express {
    interface Request {
      requestId: string;
      admin?: { sub: string; email: string; role: string };
    }
  }
}

export {};
