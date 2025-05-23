require('dotenv').config();
const express = require('express');
const axios = require('axios');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const { body, validationResult } = require('express-validator');
const morgan = require('morgan');
const compression = require('compression');

const app = express();

// ============== Configuration ==============
const CONFIG = {
  MODEL: 'facebook/bart-large-cnn',
  MAX_INPUT_LENGTH: 15000,
  MIN_INPUT_LENGTH: 50,
  RATE_LIMIT: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 150, // Increased limit
  },
  SUPPORTED_SUMMARY_TYPES: ['short', 'medium', 'long'],
  DEFAULT_SUMMARY_TYPE: 'medium'
};

// ============== Middleware ==============
app.use(helmet());
app.use(compression());
app.use(express.json({ limit: '10kb' }));
app.use(morgan('combined')); // HTTP request logging

// Enhanced rate limiting
const limiter = rateLimit({
  ...CONFIG.RATE_LIMIT,
  message: {
    status: 'error',
    message: 'Too many requests. Please try again later.'
  },
  skip: (req) => req.ip === '::1' // Skip rate limiting for localhost
});
app.use('/summarize', limiter);

// ============== Routes ==============

// Enhanced root endpoint
app.get('/', (req, res) => {
  res.json({
    status: 'success',
    message: '🚀 BART-powered Video Summarizer API',
    version: '1.0.0',
    endpoints: {
      summarize: {
        method: 'POST',
        path: '/summarize',
        description: 'Generate summaries using BART model',
        parameters: {
          videoTranscript: `string (${CONFIG.MIN_INPUT_LENGTH}-${CONFIG.MAX_INPUT_LENGTH} chars)`,
          summaryType: `optional (${CONFIG.SUPPORTED_SUMMARY_TYPES.join('|')})`
        }
      },
      health: {
        method: 'GET',
        path: '/health',
        description: 'Check API status'
      }
    }
  });
});

// Enhanced validation middleware
const validateRequest = [
  body('videoTranscript')
    .isString().withMessage('Transcript must be a string')
    .trim()
    .isLength({ 
      min: CONFIG.MIN_INPUT_LENGTH, 
      max: CONFIG.MAX_INPUT_LENGTH 
    }).withMessage(`Transcript must be between ${CONFIG.MIN_INPUT_LENGTH} and ${CONFIG.MAX_INPUT_LENGTH} characters`),
  body('summaryType')
    .optional()
    .isIn(CONFIG.SUPPORTED_SUMMARY_TYPES)
    .withMessage(`Invalid summary type. Supported types: ${CONFIG.SUPPORTED_SUMMARY_TYPES.join(', ')}`),
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        status: 'error',
        errors: errors.array().map(err => ({
          param: err.param,
          message: err.msg
        }))
      });
    }
    next();
  }
];

// Enhanced summarization endpoint
app.post('/summarize', validateRequest, async (req, res) => {
  const { videoTranscript, summaryType = CONFIG.DEFAULT_SUMMARY_TYPE } = req.body;

  try {
    const startTime = process.hrtime();
    
    // Dynamic parameters based on summary type
    const parameters = getSummaryParameters(summaryType);
    
    const response = await axios.post(
      `https://api-inference.huggingface.co/models/${CONFIG.MODEL}`,
      {
        inputs: videoTranscript,
        parameters
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.HUGGINGFACE_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000 // 30 seconds timeout
      }
    );

    const [seconds, nanoseconds] = process.hrtime(startTime);
    const processingTimeMs = (seconds * 1000) + (nanoseconds / 1000000);

    if (!response.data || !response.data[0]?.summary_text) {
      throw new Error('Invalid response from Hugging Face API');
    }

    res.json({
      status: 'success',
      data: {
        summary: response.data[0].summary_text,
        summaryType,
        length: {
          original: videoTranscript.length,
          summary: response.data[0].summary_text.length,
          ratio: `${Math.round((1 - (response.data[0].summary_text.length / videoTranscript.length)) * 100)}% reduction`
        }
      },
      performance: {
        processingTimeMs: Math.round(processingTimeMs),
        model: CONFIG.MODEL
      }
    });
  } catch (error) {
    const errorDetails = error.response?.data || error.message;
    console.error('Summarization error:', errorDetails);

    let statusCode = 500;
    let errorMessage = 'Summarization failed';
    
    if (error.response?.status === 503) {
      statusCode = 503;
      errorMessage = 'Model is currently loading. Please try again in a few seconds.';
    } else if (error.code === 'ECONNABORTED') {
      statusCode = 504;
      errorMessage = 'Request timeout. The model might be processing a large input.';
    }

    res.status(statusCode).json({
      status: 'error',
      message: errorMessage,
      details: errorDetails,
      solution: 'Try reducing the input length or try again later'
    });
  }
});

// Helper function for dynamic parameters
function getSummaryParameters(summaryType) {
  const parameters = {
    short: {
      max_length: 100,
      min_length: 30,
      do_sample: false
    },
    medium: {
      max_length: 150,
      min_length: 50,
      do_sample: false
    },
    long: {
      max_length: 250,
      min_length: 100,
      do_sample: false
    }
  };
  return parameters[summaryType] || parameters[CONFIG.DEFAULT_SUMMARY_TYPE];
}

// Enhanced health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memoryUsage: `${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB`,
    environment: process.env.NODE_ENV || 'development'
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    status: 'error',
    message: 'Endpoint not found',
    availableEndpoints: ['GET /', 'POST /summarize', 'GET /health']
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    status: 'error',
    message: 'Internal server error',
    errorId: req.id
  });
});

// Server startup
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`🤖 Using model: ${CONFIG.MODEL}`);
});