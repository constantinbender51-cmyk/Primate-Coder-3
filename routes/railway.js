const express = require('express');
const axios = require('axios');
const router = express.Router();

const RAILWAY_API_URL = 'https://backboard.railway.app/graphql/v2';

// Railway GraphQL queries
const DEPLOYMENTS_QUERY = `
  query GetDeployments($projectId: String!) {
    deployments(projectId: $projectId, limit: 5) {
      edges {
        node {
          id
          status
          createdAt
          updatedAt
          meta {
            name
            value
          }
          services {
            id
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
  query GetProject($projectId: String!) {
    project(id: $projectId) {
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
        query: DEPLOYMENTS_QUERY,
        variables: {
          projectId: process.env.RAILWAY_PROJECT_ID
        }
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.RAILWAY_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const deployments = response.data.data?.deployments?.edges;
    
    if (!deployments || deployments.length === 0) {
      return res.json({
        status: 'NO_DEPLOYMENTS',
        message: 'No deployments found'
      });
    }

    const latestDeployment = deployments[0].node;
    const services = latestDeployment.services || [];
    
    // Find the main service URL
    const mainService = services.find(service => 
      service.name === 'web' || service.name === 'app' || service.name === 'api'
    ) || services[0];

    res.json({
      status: latestDeployment.status,
      createdAt: latestDeployment.createdAt,
      updatedAt: latestDeployment.updatedAt,
      deploymentId: latestDeployment.id,
      services: services,
      url: mainService?.url,
      serviceStatus: mainService?.status
    });
  } catch (error) {
    console.error('Railway API error:', error.response?.data || error.message);
    res.status(500).json({
      error: 'Failed to fetch deployment status',
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
        query: PROJECT_QUERY,
        variables: {
          projectId: process.env.RAILWAY_PROJECT_ID
        }
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.RAILWAY_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const project = response.data.data?.project;
    
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    res.json(project);
  } catch (error) {
    console.error('Railway API error:', error);
    res.status(500).json({
      error: 'Failed to fetch project info',
      details: error.response?.data || error.message
    });
  }
});

module.exports = router;
