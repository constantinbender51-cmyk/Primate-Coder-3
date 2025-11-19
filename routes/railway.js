const express = require('express');
const axios = require('axios');
const router = express.Router();

const RAILWAY_API_URL = 'https://backboard.railway.app/graphql/v2';

// Get deployments using project token
const DEPLOYMENTS_QUERY = `
  query GetDeployments {
    deployments(limit: 5) {
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

// Get project info
const PROJECT_QUERY = `
  query {
    project {
      id
      name
      services {
        id
        name
        url
      }
    }
  }
`;

// Get latest deployment status
router.get('/status', async (req, res) => {
  try {
    if (!process.env.RAILWAY_TOKEN) {
      return res.json({
        status: 'NOT_CONFIGURED',
        message: 'RAILWAY_TOKEN not set'
      });
    }

    console.log('Using Railway project token');

    const response = await axios.post(
      RAILWAY_API_URL,
      {
        query: DEPLOYMENTS_QUERY
      },
      {
        headers: {
          'Project-Access-Token': process.env.RAILWAY_TOKEN,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log('Railway API response:', JSON.stringify(response.data, null, 2));

    if (response.data.errors) {
      return res.json({
        status: 'API_ERROR',
        message: 'GraphQL error',
        errors: response.data.errors
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
    const mainService = services[0];

    res.json({
      status: latestDeployment.status,
      createdAt: latestDeployment.createdAt,
      deploymentId: latestDeployment.id,
      services: services,
      url: mainService?.url,
      serviceStatus: mainService?.status
    });

  } catch (error) {
    console.error('Railway API error:', {
      message: error.message,
      response: error.response?.data,
      status: error.response?.status
    });

    let errorMessage = 'Failed to fetch deployment status';
    
    if (error.response?.status === 401) {
      errorMessage = 'Invalid Railway project token';
    }
    
    res.json({
      status: 'ERROR',
      message: errorMessage,
      details: error.response?.data || error.message
    });
  }
});

// Verify project access with project token
router.get('/verify', async (req, res) => {
  try {
    const response = await axios.post(
      RAILWAY_API_URL,
      {
        query: PROJECT_QUERY
      },
      {
        headers: {
          'Project-Access-Token': process.env.RAILWAY_TOKEN,
          'Content-Type': 'application/json'
        }
      }
    );

    if (response.data.errors) {
      return res.json({
        success: false,
        message: 'Cannot access project',
        errors: response.data.errors
      });
    }

    const project = response.data.data?.project;
    
    if (!project) {
      return res.json({
        success: false,
        message: 'Project not found'
      });
    }

    res.json({
      success: true,
      project: {
        id: project.id,
        name: project.name,
        services: project.services
      },
      message: 'Project access verified'
    });

  } catch (error) {
    res.json({
      success: false,
      message: 'Failed to verify project',
      error: error.response?.data || error.message
    });
  }
});

// Get project token info
router.get('/token-info', async (req, res) => {
  try {
    const response = await axios.post(
      RAILWAY_API_URL,
      {
        query: 'query { projectToken { projectId environmentId } }'
      },
      {
        headers: {
          'Project-Access-Token': process.env.RAILWAY_TOKEN,
          'Content-Type': 'application/json'
        }
      }
    );

    res.json({
      success: true,
      tokenInfo: response.data.data?.projectToken,
      data: response.data
    });

  } catch (error) {
    res.json({
      success: false,
      error: error.response?.data || error.message
    });
  }
});

module.exports = router;
