const express = require('express');
const axios = require('axios');
const router = express.Router();

const RAILWAY_API_URL = 'https://backboard.railway.app/graphql/v2';

// Fixed queries for project tokens
const DEPLOYMENTS_QUERY = `
  query GetDeployments {
    deployments {
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

const PROJECT_QUERY = `
  query GetProject {
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

    console.log('Deployments response:', JSON.stringify(response.data, null, 2));

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

    // Get the latest deployment (first in the list)
    const latestDeployment = deployments[0].node;
    const services = latestDeployment.services || [];
    
    // Find a service with a URL (usually web service)
    const mainService = services.find(service => service.url) || services[0];

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
    
    res.json({
      status: 'ERROR',
      message: 'Failed to fetch deployments',
      details: error.response?.data || error.message
    });
  }
});

// Get project info
router.get('/project', async (req, res) => {
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

    console.log('Project response:', JSON.stringify(response.data, null, 2));

    if (response.data.errors) {
      return res.json({
        success: false,
        message: 'GraphQL error',
        errors: response.data.errors
      });
    }

    const project = response.data.data?.project;
    
    if (!project) {
      return res.json({
        success: false,
        message: 'Project data not found in response'
      });
    }

    res.json({
      success: true,
      project: project,
      message: 'Project info retrieved'
    });

  } catch (error) {
    console.error('Project API error:', error.response?.data || error.message);
    res.json({
      success: false,
      message: 'Failed to fetch project',
      error: error.response?.data || error.message
    });
  }
});

// Test simple query
router.get('/test-simple', async (req, res) => {
  try {
    const response = await axios.post(
      RAILWAY_API_URL,
      {
        query: `
          query {
            deployments {
              edges {
                node {
                  id
                  status
                }
              }
            }
          }
        `
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
