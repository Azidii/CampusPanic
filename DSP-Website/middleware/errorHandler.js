export const errorHandler = (err, req, res, next) => {
  console.error(`[Error] ${req.method} ${req.url}:`, err);

  if (err.code === 11000) {
    const field = Object.keys(err.keyValue || {})[0] || 'field';
    return res.status(409).json({
      success: false,
      message: `A record with this ${field} already exists.`
    });
  }

  if (err.name === 'ValidationError') {
    const messages = Object.values(err.errors).map((val) => val.message);
    return res.status(400).json({
      success: false,
      message: messages.join(', ')
    });
  }

  if (err.name === 'MulterError') {
    return res.status(400).json({
      success: false,
      message: `File upload error: ${err.message}`
    });
  }

  const statusCode = res.statusCode !== 200 ? res.statusCode : 500;
  
  if (req.accepts('html') && !req.path.startsWith('/api/')) {
    return res.status(statusCode).render('404', {
      title: 'Server Error — CampusPanic',
      page: 'error',
      user: req.user || null,
      message: err.message || 'An unexpected server error occurred.'
    });
  }

  res.status(statusCode).json({
    success: false,
    message: err.message || 'Internal server error'
  });
};
