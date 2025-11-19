const express = require('express');
const axios = require('axios');
const router = express.Router();

const RAILWAY_API_URL = 'https://backboard.railway.app/graphql/v2';

// Simple deployment status query
const SIMPLE_STATUS_QUERY = `
  query GetDeployments($projectId: String!) {
    deployments(projectId: $projectId, limit: 1) {
      edges {
        node {
          id
          status
          createdAt
          services {
            name
            status
            url
          }
        }
      }
    }
  }
`;

// Get latest deployment status
router.get('/status', async (req, res) => {
  try {
    // Check if environment variables are set
    if (!process.env.RAILWAY_TOKEN || !process.env.RAILWAY_APP_PROJECT_ID) {
      return res.json({
        status: 'NOT_CONFIGURED',
        message: 'Railway not configured'
      });
    }

    const response = await axios.post(
      RAILWAY_API_URL,
      {
        query: SIMPLE_STATUS_QUERY,
        variables: {
          projectId: process.env.RAILWAY_APP_PROJECT_ID
        }
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.RAILWAY_TOKEN}`,
          'Content-Type': 'application/json',
          'User-Agent': 'AI-Code-Editor/1.0'
        },
        timeout: 10000 // 10 second timeout
      }
    );

    // Check for GraphQL errors
    if (response.data.errors) {
      console.error('Railway GraphQL errors:', response.data.errors);
      return res.json({
        status: 'API_ERROR',
        message: response.data.errors[0]?.message || 'GraphQL error'
      });
    }

    const deployments = response.data.data?.deployments?.edges;
    
    if (!deployments || deployments.length === 0) {
      return res.json({
        status: 'NO_DEPLOYMENTS',
        message: 'No deployments found'
      });
    }

    const latestDeployment = deployments[0].node;
    const services = latestDeployment.services || [];
    
    // Find the main service
    const mainService = services.find(service => 
      service.name === 'web' || service.name === 'app' || service.name === 'api'
    ) || services[0];

    res.json({
      status: latestDeployment.status,
      createdAt: latestDeployment.createdAt,
      deploymentId: latestDeployment.id,
      services: services,
      url: mainService?.url,
      serviceStatus: mainService?.status
    });
  } catch (error) {
    console.error('Railway API error:', error.response?.data || error.message);
    
    // Provide more specific error messages
    let errorMessage = 'Failed to fetch deployment status';
    
    if (error.response?.status === 401) {
      errorMessage = 'Invalid Railway token';
    } else if (error.response?.status === 404) {
      errorMessage = 'Project not found';
    } else if (error.code === 'ECONNREFUSED') {
      errorMessage = 'Cannot connect to Railway API';
    }
    
    res.json({
      status: 'ERROR',
      message: errorMessage,
      details: error.response?.data || error.message
    });
  }
});

// Simple health check endpoint
router.get('/health', async (req, res) => {
  try {
    const response = await axios.post(
      RAILWAY_API_URL,
      {
        query: '{ __schema { types { name } } }' // Simple schema query
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.RAILWAY_TOKEN}`,
          'Content-Type': 'application/json'
        },
        timeout: 5000
      }
    );
    
    res.json({ status: 'OK', message: 'Railway API is accessible' });
  } catch (error) {
    res.json({ 
      status: 'ERROR', 
      message: 'Cannot connect to Railway API',
      details: error.response?.data || error.message
    });
  }
});

module.exports = router;
